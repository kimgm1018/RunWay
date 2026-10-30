"""Future HR Predictor (GRU): 테스트·서비스에서 부르는 예측 함수.

    from predictor import load
    predictor = load()                   # ../model/gru_final.pt = M3-005(경사 앎) + M3-006(경사 모름), CPU 기본
    predictor.personalize(support)       # 개인화 ON (그 사람 Support 세션)
    hr = predictor.predict(batch)        # (N, 3) = [HR@30, HR@60, HR@120] bpm
    hr_off = predictor.predict(batch, personalized=False)   # 개인화 OFF로 같은 batch 예측
    predictor.reset()                    # 개인화 OFF = population 기본 상태 (사용자 바뀔 때)

batch: 두 형식 중 하나. 값은 원래 단위, 5초 간격.
  (1) window(dict)의 리스트
    hr, speed, grade   현재 러닝 시작부터 t0까지의 원본 (bpm, m/s, %). 마지막 칸이 t0. 빈 값(NaN) 있어도 됨
    elapsed_s          (선택) 같은 길이의 경과 시간 배열 또는 t0의 경과 시간 숫자 (초). 없으면 0, 5, 10, ...으로 본다
    segment_id         (선택) 같은 길이의 구간 번호. 있으면 t0와 같은 구간만 쓴다 (segment도 같은 뜻)
    future_speed       t0 이후 24칸 속도 계획 (m/s)
    future_grade       t0 이후 24칸 경사 (%). 없거나(None) 한 칸이라도 비어 있으면(NaN) "경사 모름"으로 본다
    hr0                (선택) 현재 심박. 없으면 hr의 마지막 칸
  (2) 키마다 window N개를 묶은 dict: hr·speed·grade·segment는 [N, L] 배열(앞쪽 빈 칸은 NaN) 또는 1차원 배열 N개,
      elapsed_s는 [N](t0 경과 시간), future_speed는 [N, 24], future_grade는 [N, 24] 또는 None

경사를 아는지에 따라 모델을 고른다 (grade-missing 정책).
 - future_grade가 있으면: 메인 모델 (M3-005, 미래 경사를 읽음)
 - future_grade가 없으면: 경사 없는 모델 (M3-006, 미래 경사 없이 학습). 없는 모델을 지정하지 않았으면 메인 모델에 0% 평지로 채움

support: 그 사람 Support 러닝들. 셋 중 하나.
  - canonical 컬럼(session_id, segment_id, elapsed_s, hr_bpm, speed_mps, grade_observed_pct, 선택: hr_is_filled, hr_quality)의 DataFrame
  - 위 DataFrame의 리스트 (러닝마다 하나)
  - 러닝마다 dict 하나인 리스트: elapsed_s·hr·speed·grade 배열 (선택: segment, session_id). grade가 없으면 0%로 본다

전처리는 학습 때와 같다.
 - 현재 러닝: t0와 같은 구간에서 심박·속도·경사 중 빈 값이 있는 줄을 빼고, 최근 72칸(6분)을 쓴다.
   72칸보다 짧으면 앞을 빈칸(0, 과거표시 0)으로 채운다 (window를 빼지 않는다)
 - 정규화: 체크포인트에 저장된 Train 평균·표준편차
 - 미래 속도: Flat으로 학습한 모델(--flat-future)만 24칸 평균으로 평평하게 바꾸고, 그 밖의 모델은 그대로 넣는다
 - 경사는 전처리와 같이 -30 ~ +30%로 자른다
 - 경과 시간은 체크포인트의 elapsed_clip(120분)에서 자르고 600으로 나눈다
모델은 HR 변화량을 내므로 HR0를 더해 bpm으로 돌려준다.

개인화: GRU는 그대로 두고 마지막 출력층(hidden → 3)만 Support 샘플로 조정한다 (기본 출력층에서 멀어지지 않게 L2 0.03, val에서 선택).
 두 모델 모두 같은 Support로 각자 출력층을 맞춘다.
 ON = personalize 후, OFF = reset 후, Cold-start = personalize 없이 (OFF와 같음). Query로는 개인화하지 않는다.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

from data import FEATURES, TARGET, FUT, ELAPSED_SCALE, EVAL_STRIDE, GROUP_COLS, HorizonDataset, Normalizer
from model import HorizonGRU

GRADE_CLIP = 30.0   # 전처리의 경사 범위 (%)
MAIN, NOGRADE = "main", "nograde"
MODEL_DIR = Path(__file__).resolve().parent.parent / "model"   # 인계 폴더: src/ 옆의 model/


def runs_to_frame(runs):
    """러닝 dict 리스트(elapsed_s·hr·speed·grade 배열) → canonical 컬럼 DataFrame."""
    parts = []
    for i, r in enumerate(runs):
        n = len(r["hr"])
        parts.append(pd.DataFrame({
            "session_id": r.get("session_id", f"run{i}"),
            "segment_id": np.asarray(r["segment"]) if r.get("segment") is not None else np.asarray(r.get("segment_id", 0)),
            "elapsed_s": np.asarray(r["elapsed_s"], np.float32) if r.get("elapsed_s") is not None else 5.0 * np.arange(n, dtype=np.float32),
            "hr_bpm": np.asarray(r["hr"], np.float32),
            "speed_mps": np.asarray(r["speed"], np.float32),
            "grade_observed_pct": np.asarray(r["grade"], np.float32) if r.get("grade") is not None else np.zeros(n, np.float32),
        }))
    return pd.concat(parts, ignore_index=True) if parts else None


def batch_to_windows(batch):
    """키마다 window N개를 묶은 dict → window dict 리스트. 이미 리스트면 그대로."""
    if not isinstance(batch, dict):
        return batch
    n = len(batch["future_speed"])
    grade = batch.get("future_grade")
    seg = batch.get("segment", batch.get("segment_id"))
    windows = []
    for i in range(n):
        w = {k: np.asarray(batch[k][i], np.float32) for k in ["hr", "speed", "grade"]}
        if seg is not None:
            w["segment_id"] = np.asarray(seg[i])
        if batch.get("elapsed_s") is not None:
            w["elapsed_s"] = batch["elapsed_s"][i]
        w["future_speed"] = np.asarray(batch["future_speed"][i], np.float32)
        w["future_grade"] = None if grade is None else np.asarray(grade[i], np.float32)
        if batch.get("hr0") is not None:
            w["hr0"] = batch["hr0"][i]
        windows.append(w)
    return windows


def read_checkpoint(checkpoint, device):
    """체크포인트 파일 → dict. 두 모델을 묶은 파일(gru_final.pt: {"main": ..., "nograde": ...})도 그대로 돌려준다."""
    return torch.load(Path(checkpoint).expanduser(), map_location=device, weights_only=False)


def load_net(ckpt, device):
    """체크포인트 dict → 모델, 학습 설정, 정규화 기준값."""
    a = ckpt["args"]
    assert a.get("use_elapsed"), "경과 시간 입력 모델만 지원"
    model = HorizonGRU(n_inputs=5, hidden=a["hidden"], layers=a["layers"], dropout=a.get("dropout", 0.0),
                       mask_future_grade=a.get("no_future_grade", False)).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    return model, a, pd.Series(ckpt["norm_mean"]), pd.Series(ckpt["norm_std"])


class GRUPredictor:
    def __init__(self, checkpoint, device="cpu", nograde_checkpoint=None):
        ckpt = read_checkpoint(checkpoint, device)
        if "main" in ckpt:                           # 두 모델을 묶은 파일: 안에 든 경사 없는 모델을 쓴다
            ckpt, nograde = ckpt["main"], ckpt.get("nograde")
        else:
            nograde = read_checkpoint(nograde_checkpoint, device) if nograde_checkpoint is not None else None
        self.model, a, mean, std = load_net(ckpt, device)
        self.flat = bool(a.get("flat_future"))       # Flat으로만 학습했으면 입력 미래 속도도 평평하게
        self.device = device
        self.hist = a["hist"]
        self.elapsed_clip = a["elapsed_clip"]
        self.mean = np.array([mean[FEATURES[0]], mean[FEATURES[1]], mean[TARGET]], np.float32)   # 속도, 경사, 심박
        self.std = np.array([std[FEATURES[0]], std[FEATURES[1]], std[TARGET]], np.float32)
        self.norm = object.__new__(Normalizer)
        self.norm.mean, self.norm.std = mean, std
        self.models = {MAIN: self.model}
        self.flats = {MAIN: self.flat}
        if nograde is not None:                      # 경사 모를 때 쓰는 모델: 입력 처리·정규화가 같아야 한다
            m2, a2, mean2, std2 = load_net(nograde, device)
            assert a2.get("no_future_grade"), "경사 없는 모델은 --no-future-grade로 학습한 체크포인트여야 한다"
            assert (a2["hist"], a2["elapsed_clip"]) == (self.hist, self.elapsed_clip), "과거 길이·경과 시간 설정이 달라 함께 쓸 수 없다"
            assert np.allclose(mean2.values, mean.values) and np.allclose(std2.values, std.values), "정규화 기준값이 다르다"
            self.models[NOGRADE] = m2
            self.flats[NOGRADE] = bool(a2.get("flat_future"))
        self.base = self.get_state()                 # population 기본 출력층 (reset에 씀)
        self.base_head = self.base[MAIN]

    # ---------- 개인화 ----------
    def get_state(self):
        """모델별 출력층 {"main": (weight, bias), "nograde": ...}."""
        return {k: (m.head.weight.detach().clone(), m.head.bias.detach().clone()) for k, m in self.models.items()}

    def save_state(self, path):
        """지금 끼워진 개인화 출력층을 파일로 저장한다 (사용자별 보관용)."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        torch.save({k: (w.cpu(), b.cpu()) for k, (w, b) in self.get_state().items()}, path)

    def load_state(self, state):
        """get_state/personalize가 돌려준 출력층(또는 save_state로 저장한 파일 경로)을 다시 끼운다 (None = 기본 상태)."""
        if isinstance(state, (str, Path)):
            state = torch.load(state, map_location="cpu", weights_only=False)
        state = state if state is not None else self.base
        with torch.no_grad():
            for k, m in self.models.items():
                w, b = state[k]
                m.head.weight.copy_(w.to(self.device))
                m.head.bias.copy_(b.to(self.device))

    def reset(self):
        """개인화 OFF: 모든 모델을 population 기본 출력층으로 되돌린다."""
        self.load_state(None)

    def support_features(self, support, key=MAIN, stride=EVAL_STRIDE):
        """Support 시계열 → 출력층 입력(GRU 마지막 상태), 정답 변화량(정규화), 채점 가능 여부. 미래 속도는 predict와 같게 처리."""
        if isinstance(support, (list, tuple)) and support and isinstance(support[0], dict):
            df = runs_to_frame(support)                                     # 러닝 dict 리스트
        elif isinstance(support, (list, tuple)):
            df = pd.concat(support, ignore_index=True) if support else None   # DataFrame 리스트
        else:
            df = support
        if df is None or len(df) == 0:
            return None
        df = df.assign(**{c: v for c, v in [("segment_id", 0), ("hr_is_filled", False), ("hr_quality", "GOOD")]
                          if c not in df.columns})
        df = df.dropna(subset=FEATURES + [TARGET]).sort_values(GROUP_COLS + ["elapsed_s"])
        ds = HorizonDataset(self.norm(df), stride=stride, use_elapsed=True, hist=self.hist, elapsed_clip=self.elapsed_clip)
        model, flat = self.models[key], self.flats[key]
        feats, ys, valids = [], [], []
        with torch.no_grad():                                                # GRU만 쓰므로 지금 출력층 상태와 무관
            for seq, target, current, valid, _ in DataLoader(ds, batch_size=1024):
                if flat:
                    seq[:, -FUT:, 0] = seq[:, -FUT:, 0].mean(1, keepdim=True)
                feats.append(model.features(seq.to(self.device))); ys.append((target - current[:, None]).to(self.device)); valids.append(valid.to(self.device))
        if not feats:
            return None
        return torch.cat(feats), torch.cat(ys), torch.cat(valids).float()

    def fit_head(self, base, features, steps=100, lr=1e-3, l2=0.03):
        """기본 출력층에서 시작해 Support 특징으로 출력층(weight, bias)을 맞춘다. 쓸 샘플이 없으면 기본 그대로."""
        if features is None or features[2].sum() == 0:
            return base
        x, y, m = features
        w0, b0 = base
        w, b = w0.clone().requires_grad_(), b0.clone().requires_grad_()
        opt = torch.optim.Adam([w, b], lr=lr)
        for _ in range(steps):
            err = (x @ w.T + b - y).abs()
            loss = (err * m).sum() / m.sum() + l2 * (((w - w0) ** 2).sum() + ((b - b0) ** 2).sum())
            opt.zero_grad()
            loss.backward()
            opt.step()
        return w.detach(), b.detach()

    def personalize(self, support, steps=100, lr=1e-3, l2=0.03, stride=EVAL_STRIDE):
        """개인화 ON: 그 사람 Support로 모델마다 출력층을 맞춰 끼우고 그 상태를 돌려준다."""
        state = {k: self.fit_head(self.base[k], self.support_features(support, k, stride), steps, lr, l2) for k in self.models}
        self.load_state(state)
        return self.get_state()

    # ---------- 예측 ----------
    @staticmethod
    def grade_missing(w):
        g = w.get("future_grade")
        return g is None or np.isnan(np.asarray(g, np.float32)).any()

    def make_input(self, w, flat=None):
        """window 1개 → 모델 입력 (hist + 24, 5). HorizonDataset.__getitem__과 같은 모양."""
        flat = self.flat if flat is None else flat
        n = len(w["hr"])
        if n == 0:
            raise ValueError("현재 러닝 정보(hr·speed·grade)는 t0를 포함해 1칸 이상 있어야 한다")
        el = np.atleast_1d(np.asarray(w["elapsed_s"], np.float32)) if w.get("elapsed_s") is not None else 5.0 * np.arange(n, dtype=np.float32)
        past = np.column_stack([w["speed"], w["grade"], w["hr"]]).astype(np.float32)
        keep = ~np.isnan(past).any(1)                                        # 학습 때처럼 빈 값 있는 줄은 뺀다
        seg = w.get("segment_id", w.get("segment"))
        if seg is not None:
            seg = np.asarray(seg)
            keep &= seg == seg[-1]                                           # t0와 같은 구간만
        past = past[keep][-self.hist:]
        past[:, 1] = np.clip(past[:, 1], -GRADE_CLIP, GRADE_CLIP)
        n_pad = self.hist - len(past)

        grade = w.get("future_grade")
        grade = np.zeros(FUT, np.float32) if grade is None else np.nan_to_num(np.asarray(grade, np.float32), nan=0.0)   # 모르면 0 (경사 없는 모델은 어차피 안 읽음)
        future = np.column_stack([w["future_speed"], np.clip(grade, -GRADE_CLIP, GRADE_CLIP)]).astype(np.float32)
        if future.shape != (FUT, 2) or np.isnan(future).any():
            raise ValueError(f"future_speed는 빈 값 없는 {FUT}칸, future_grade는 {FUT}칸이어야 한다")
        if flat:
            future[:, 0] = future[:, 0].mean()                               # Flat 모델: 미래 속도 = 2분 평균

        past = (past - self.mean) / self.std
        future = (future - self.mean[:2]) / self.std[:2]
        seq = np.vstack([np.zeros((n_pad, 4), np.float32),
                         np.column_stack([past, np.ones(len(past), np.float32)]),          # 과거표시 1
                         np.column_stack([future, np.zeros((FUT, 2), np.float32)])])       # 심박 모름, 과거표시 0

        times = el[-1] + 5.0 * np.arange(-(self.hist - 1), FUT + 1, dtype=np.float32)    # t0 경과 시간 기준
        t_col = np.clip(times, 0, self.elapsed_clip) / ELAPSED_SCALE
        t_col[:n_pad] = 0                                                    # 빈칸은 0
        return np.column_stack([seq, t_col]).astype(np.float32)

    def predict(self, batch, personalized=True):
        """window 리스트(또는 묶음 dict) → (N, 3) 심박 [HR@30, HR@60, HR@120] (bpm).
        personalized=True: 지금 끼워진 개인화 상태로, False: 개인화 OFF(기본 상태)로 예측한다. 상태는 바꾸지 않는다."""
        if not personalized:
            saved = self.get_state()
            self.load_state(None)
            try:
                return self.predict(batch)
            finally:
                self.load_state(saved)
        batch = batch_to_windows(batch)
        if len(batch) == 0:
            return np.zeros((0, 3), np.float32)
        hr0 = np.array([w["hr0"] if w.get("hr0") is not None else w["hr"][-1] for w in batch], np.float32)
        if np.isnan(hr0).any():
            raise ValueError("HR0(hr의 마지막 칸 또는 hr0)는 실제 측정값이어야 한다")
        missing = np.array([self.grade_missing(w) for w in batch]) if NOGRADE in self.models else np.zeros(len(batch), bool)
        delta = np.zeros((len(batch), 3), np.float32)
        for key, rows in [(MAIN, np.flatnonzero(~missing)), (NOGRADE, np.flatnonzero(missing))]:
            if len(rows) == 0:
                continue
            x = torch.from_numpy(np.stack([self.make_input(batch[i], self.flats[key]) for i in rows])).to(self.device)
            with torch.no_grad():
                delta[rows] = self.models[key](x).cpu().numpy() * self.std[2]   # 변화량 (bpm)
        return hr0[:, None] + delta


def load(checkpoint=MODEL_DIR / "gru_final.pt", device="cpu", nograde_checkpoint=None):
    """기본: 인계 폴더 model/gru_final.pt (경사 앎 M3-005 + 경사 모름 M3-006을 묶은 파일).
    모델 파일 하나만 주고 nograde_checkpoint=None이면 경사 모를 때 0% 평지로 채운다."""
    return GRUPredictor(checkpoint, device, nograde_checkpoint)
