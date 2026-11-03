"""ODE v2.1 모델 (CONTRACT 3절).

v2 odev2/model.py에서 복사해 고쳤다(원본 sha는 SOURCES.json). v2와 다른 점:
- 범위: B (−3, 8), alpha (0.03, 3), hr_min (40, 120).
- 적분: 10초 step 안 intensity 상수. demand는 정확한 해 D(s) = I + (D − I)·exp(−k s), k = e^B/60,
  HR은 고전 RK4(stage마다 D(0), D(½), D(½), D(1)). RK4로는 B ≤ 5.12에서만 안정이라 바꿨다(계약 0절).
- 파라미터 망 입력 = z 12D(hr_ref 제거). 요약 u 27개.
- 오늘 인코더 두 변형: 'cnn'(v2와 같음), 'gru'(GRU hidden 64, t0 행 출력).
- 바닥·천장 분기: Amendment 1의 'max' 규칙(HR0 < hr_min에서 갇히지 않음).
"""
from __future__ import annotations

from typing import Any

import torch
from torch import Tensor, nn
from torch.nn.utils.parametrizations import weight_norm

from . import summary as S
from . import today as T

EPSILON = 1e-3
Z_DIM = 12
P4_DIM, H8_DIM = 4, 8
HISTORY_DIM = 5
PIN_DIM = Z_DIM
D0_SCALE = 30.0
BOUNDS = {'A': (-3.0, 5.0), 'B': (-3.0, 8.0), 'alpha': (0.03, 3.0), 'beta': (0.1, 3.0),
          'hr_min': (40.0, 120.0), 'hr_max': (140.0, 210.0)}
ACTIVITY_BOUNDS = (30.0, 250.0)
FATIGUE_BOUNDS = (0.5, 1.5)
HR_STD = 5.0
ENCODERS = ('cnn', 'gru')
# 바닥·천장 분기 규칙 (CONTRACT Amendment 1). 'max': hr ≤ hr_min이면 max(정상, hr_min − hr), hr ≥ hr_max이면 min(정상, hr_max − hr).
# 'trap' = v1·v2(Apple)와 같음: hr ≤ hr_min이면 dHR = hr_min − hr 만(HR0 < hr_min이면 hr_min 아래에 갇힘). 테스트·진단 비교용.
BOUND_RULE = 'max'


class Chomp1d(nn.Module):
    def __init__(self, chomp_size: int) -> None:
        super().__init__()
        self.chomp_size = chomp_size

    def forward(self, value: Tensor) -> Tensor:
        return value[:, :, : -self.chomp_size] if self.chomp_size else value


class CausalBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 6) -> None:
        super().__init__()
        padding = kernel_size - 1
        self.causal = nn.Sequential(
            weight_norm(nn.Conv1d(in_channels, out_channels, kernel_size, padding=padding)), Chomp1d(padding),
            nn.LeakyReLU(),
            weight_norm(nn.Conv1d(out_channels, out_channels, kernel_size, padding=padding)), Chomp1d(padding),
            nn.LeakyReLU(),
        )
        self.residual = nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else nn.Identity()

    def forward(self, value: Tensor) -> Tensor:
        return self.causal(value) + self.residual(value)


def _masked_mean(encoded: Tensor, mask: Tensor) -> Tensor:
    """encoded [B, C, L], mask [B, L] → [B, C]. mask가 모두 0이면 0."""
    m = mask.to(encoded.dtype)
    return (encoded * m.unsqueeze(1)).sum(-1) / m.sum(-1, keepdim=True).clamp(min=1.0)


class HistoryEncoder(nn.Module):
    """Apple CNNEncoder: causal block 1개(128ch, kernel 6), masked mean, Linear."""

    def __init__(self, input_dim: int = HISTORY_DIM, channels: int = 128, output_dim: int = H8_DIM,
                 kernel_size: int = 6) -> None:
        super().__init__()
        self.causal_cnn = CausalBlock(input_dim, channels, kernel_size)
        self.linear = nn.Linear(channels, output_dim)

    def forward(self, history: Tensor, lengths: Tensor) -> Tensor:
        lengths = lengths.to(device=history.device, dtype=torch.long)
        encoded = self.causal_cnn(history.transpose(1, 2))
        positions = torch.arange(encoded.shape[-1], device=encoded.device).unsqueeze(0)
        return self.linear(_masked_mean(encoded, positions < lengths.unsqueeze(1)))


def _head() -> nn.Sequential:
    mlp = nn.Sequential(nn.Linear(64 + T.N_SUMMARY, 64), nn.ELU(), nn.Linear(64, Z_DIM + 1))
    nn.init.zeros_(mlp[-1].weight)
    nn.init.zeros_(mlp[-1].bias)
    return mlp


class TodayEncoder(nn.Module):
    """v21_base: t0 전 420초(84칸 × 4) causal CNN + masked mean(HR 실측 칸) ⊕ 출발~t0 요약 → (Δz_today 12, D0 원값 1)."""

    def __init__(self, channels: int = 64, kernel_size: int = 5) -> None:
        super().__init__()
        pad = kernel_size - 1
        self.conv = nn.Sequential(nn.Conv1d(4, channels, kernel_size, padding=pad), Chomp1d(pad), nn.LeakyReLU(),
                                  nn.Conv1d(channels, channels, kernel_size, padding=pad), Chomp1d(pad), nn.LeakyReLU())
        self.mlp = _head()

    def forward(self, window: Tensor, summary: Tensor) -> tuple:
        pooled = _masked_mean(self.conv(window.transpose(1, 2)), window[:, :, 3])
        out = self.mlp(torch.cat((pooled, summary), dim=-1))
        return out[:, :Z_DIM], out[:, Z_DIM]


class TodayEncoderGRU(nn.Module):
    """v21_gru: 84행을 시간순으로 GRU(hidden 64)로 읽고 마지막 행(t0) 출력 ⊕ 출발~t0 요약 → (Δz_today 12, D0 원값 1)."""

    def __init__(self, hidden: int = 64) -> None:
        super().__init__()
        self.rnn = nn.GRU(4, hidden, num_layers=1, batch_first=True)
        self.mlp = _head()

    def forward(self, window: Tensor, summary: Tensor) -> tuple:
        seq, _ = self.rnn(window)
        out = self.mlp(torch.cat((seq[:, -1], summary), dim=-1))
        return out[:, :Z_DIM], out[:, Z_DIM]


class DenseNN(nn.Module):
    """Apple DenseNN: softplus hidden, 선택적 scaled sigmoid 범위."""

    def __init__(self, *dimensions: int, output_bounds: tuple | None = None) -> None:
        super().__init__()
        self.layers = nn.ModuleList(nn.Linear(a, b) for a, b in zip(dimensions, dimensions[1:]))
        self.activation = nn.Softplus()
        self.output_bounds = output_bounds

    def forward(self, value: Tensor) -> Tensor:
        for layer in self.layers[:-1]:
            value = self.activation(layer(value))
        value = self.layers[-1](value)
        if self.output_bounds is not None:
            low, high = self.output_bounds
            value = torch.sigmoid(value) * (high - low) + low
        return value


class PersonalizedScalarNN(nn.Module):
    """Apple softmax 개인화: Z_DIM개 함수를 softmax(z) 무게로 섞는다."""

    def __init__(self, dimensions: tuple, output_bounds: tuple) -> None:
        super().__init__()
        self.dense_nn = DenseNN(*dimensions, Z_DIM, output_bounds=output_bounds)

    def forward(self, value: Tensor, context: Tensor) -> Tensor:
        return (self.dense_nn(value) * torch.softmax(context, dim=-1)).sum(dim=-1)


def hr_rate(hr: Tensor, demand: Tensor, p: dict) -> Tensor:
    """Apple dHR/dt (10초 step 단위). 바닥·천장 분기는 BOUND_RULE을 따른다."""
    f_min = ((torch.abs(hr - p['hr_min'] + EPSILON) + EPSILON) / 60.0).pow(p['alpha'])
    f_max = ((torch.abs(p['hr_max'] - hr + EPSILON) + EPSILON) / 60.0).pow(p['beta'])
    normal = torch.exp(p['A']) * f_min * f_max * (demand - hr) / 60.0
    floor, ceil = p['hr_min'] - hr, p['hr_max'] - hr
    if BOUND_RULE == 'max':
        return torch.where(hr >= p['hr_max'], torch.minimum(normal, ceil),
                           torch.where(hr <= p['hr_min'], torch.maximum(normal, floor), normal))
    return torch.where(hr >= p['hr_max'], ceil, torch.where(hr <= p['hr_min'], floor, normal))


def integrate(hr0: Tensor, d0: Tensor, intensity: Tensor, p: dict) -> tuple:
    """step i(10초)마다 intensity[:, i] 상수. demand 정확한 해 + HR 고전 RK4. 반환 (HR, D) [B, L] = step 끝 값."""
    k = torch.exp(p['B']) / 60.0
    e_half, e_full = torch.exp(-0.5 * k), torch.exp(-k)
    hr, dem = hr0, d0
    hrs, dems = [], []
    for i in range(intensity.shape[1]):
        inten = intensity[:, i]
        gap = dem - inten
        d_half, d_full = inten + gap * e_half, inten + gap * e_full
        k1 = hr_rate(hr, dem, p)
        k2 = hr_rate(hr + 0.5 * k1, d_half, p)
        k3 = hr_rate(hr + 0.5 * k2, d_half, p)
        k4 = hr_rate(hr + k3, d_full, p)
        hr = hr + (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0
        dem = d_full
        hrs.append(hr)
        dems.append(dem)
    return torch.stack(hrs, dim=1), torch.stack(dems, dim=1)


class V21ODE(nn.Module):

    def __init__(self, n_groups: int, encoder: str = 'cnn') -> None:
        super().__init__()
        if encoder not in ENCODERS:
            raise ValueError(f'encoder는 {ENCODERS} 중 하나: {encoder}')
        self.n_groups, self.encoder = int(n_groups), encoder
        self.p4 = nn.Embedding(max(int(n_groups), 1), P4_DIM)
        nn.init.zeros_(self.p4.weight)
        self.history_encoder = HistoryEncoder()
        self.summary_mlp = nn.Sequential(nn.Linear(2 * S.N_FEATURES, 32), nn.ELU(), nn.Linear(32, Z_DIM))
        nn.init.zeros_(self.summary_mlp[-1].weight)
        nn.init.zeros_(self.summary_mlp[-1].bias)
        self.today_encoder = TodayEncoder() if encoder == 'cnn' else TodayEncoderGRU()
        self.parameter_networks = nn.ModuleDict(
            {name: DenseNN(PIN_DIM, 32, 8, 1, output_bounds=b) for name, b in BOUNDS.items()})
        self.activity_fn = PersonalizedScalarNN((2, 128, 64), output_bounds=ACTIVITY_BOUNDS)
        self.fatigue_fn = DenseNN(1, 32, 16, 1, output_bounds=FATIGUE_BOUNDS)

    def config(self) -> dict:
        return dict(n_groups=self.n_groups, encoder=self.encoder)

    def person_z(self, batch: dict) -> Tensor:
        keep = batch['p4_keep'].to(batch['u_vals'].dtype).unsqueeze(-1)
        if 'p4' in batch:
            p4 = batch['p4'] * keep
        else:
            idx = batch['group_index']
            known = (idx >= 0).to(keep.dtype).unsqueeze(-1)
            p4 = self.p4(idx.clamp(min=0)) * known * keep
        h8 = self.history_encoder(batch['history'], batch['history_length'])
        usual = self.summary_mlp(torch.cat((batch['u_vals'], batch['u_mask'].to(batch['u_vals'].dtype)), dim=-1))
        return torch.cat((p4, h8), dim=-1) + usual

    def parameter_values(self, pin: Tensor) -> dict:
        return {name: net(pin).squeeze(-1) for name, net in self.parameter_networks.items()}

    @staticmethod
    def derivative(state: Tensor, intensity: Tensor, p: dict) -> Tensor:
        """2-state 전체 미분(기준해·테스트용). 학습·추론 적분은 integrate()를 쓴다."""
        hr, demand = state[..., 0], state[..., 1]
        return torch.stack((hr_rate(hr, demand, p), (intensity - demand) / 60.0 * torch.exp(p['B'])), dim=-1)

    def simulate(self, z: Tensor, pin: Tensor, hr_t0: Tensor, d0: Tensor, activity: Tensor,
                 time: Tensor) -> dict[str, Any]:
        """heart_rate[:, i] = t0 + 10·(i+1)초의 HR. 시작 상태 (HR(t0), D0)."""
        if activity.ndim != 3 or activity.shape[-1] != 2 or time.shape != activity.shape[:2]:
            raise ValueError('activity [B,L,2], time [B,L] 모양이 맞지 않는다')
        p = self.parameter_values(pin)
        activity_coefficient = self.activity_fn(activity, z.unsqueeze(1).expand(-1, activity.shape[1], -1))
        fatigue_coefficient = self.fatigue_fn(time.unsqueeze(-1)).squeeze(-1)
        intensity = activity_coefficient * fatigue_coefficient
        hr, demand = integrate(hr_t0.to(intensity.dtype), d0.to(intensity.dtype), intensity, p)
        return dict(heart_rate=hr, demand=demand, parameters=p, intensity=intensity)

    def forward(self, batch: dict) -> dict[str, Any]:
        zp = self.person_z(batch)
        dz, o = self.today_encoder(batch['today_window'], batch['today_summary'])
        z = zp + dz
        d0 = batch['hr_t0'] + D0_SCALE * torch.tanh(o)
        out = self.simulate(z, z, batch['hr_t0'], d0, batch['activity'], batch['time'])
        out.update(z=z, z_person=zp, d0=d0)
        return out


def apple_loss(pred: Tensor, y: Tensor, mask: Tensor, z: Tensor, hr_std: float = HR_STD,
               z_weight: float = 1.0, weight: Tensor | None = None) -> tuple:
    """가중 Apple 손실: Σ w·((HR̂ − HR)/σ)² (채점 점) + z_weight·Σz². weight None이면 1."""
    diff = torch.where(mask, pred - torch.nan_to_num(y), torch.zeros_like(pred))
    sq = (diff / hr_std).square()
    reconstruction = (sq * weight).sum() if weight is not None else sq.sum()
    z_l2 = z.square().sum() * z_weight
    parts = dict(reconstruction=reconstruction, z_l2=z_l2, l1_sum=diff.abs().sum().detach(),
                 n_points=mask.sum().detach())
    return reconstruction + z_l2, parts


def points30(heart_rate: Tensor, n_points: int) -> Tensor:
    """10초 출력 → t0 + 30·j초 점(j = 1 … n_points, index 3j − 1)."""
    return heart_rate[:, 2:3 * n_points:3]
