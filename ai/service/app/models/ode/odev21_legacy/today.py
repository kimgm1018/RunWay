"""오늘 인코더 입력 (CONTRACT 3.3·3.4절): t0 전 420초 5초 행 84개와 출발부터 t0까지 요약.

r = dict(hr5, sp5, gr5): 세션 5초 행 0..6·n_cell. hr5는 채점 규칙의 실측 HR(아니면 NaN),
sp5·gr5는 pv_data의 LOCF action 행(행 0은 서 있는 상태 0). t0 = 5·r0초 = 행 r0 (v2.1: 5초 격자).
"""
from __future__ import annotations

import numpy as np

WINDOW = 84                      # 420초 / 5초
HR_CENTER, HR_SCALE = 142.0, 22.0
MIN_PAIRS = 24
MIN_SPEED_VAR = 0.01
SUMMARY_NAMES = ['elapsed', 'hr_start', 'hr_max', 'hr_mean', 'hr_min', 'speed_mean', 'slope', 'slope_missing',
                 'is_t0_zero', 'missing']
N_SUMMARY = len(SUMMARY_NAMES)


def _hr(x):
    return (x - HR_CENTER) / HR_SCALE


def window(r: dict, r0: int) -> np.ndarray:
    """[84, 4] = (HR norm, 속도, 경사/10, HR 실측 mask). 행 r0 − 83 … r0만 쓴다(그 뒤는 보지 않는다)."""
    r0 = int(r0)
    idx = np.arange(r0 - WINDOW + 1, r0 + 1)
    out = np.zeros((WINDOW, 4), np.float32)
    ok = idx >= 0
    j = idx[ok]
    hr = np.asarray(r['hr5'], np.float64)[j]
    m = np.isfinite(hr)
    sp = np.nan_to_num(np.asarray(r['sp5'], np.float64)[j])
    gr = np.nan_to_num(np.asarray(r['gr5'], np.float64)[j])
    out[ok, 0] = np.where(m, _hr(np.nan_to_num(hr)), 0.0)
    out[ok, 1] = sp
    out[ok, 2] = gr / 10.0
    out[ok, 3] = m
    return out


def run_summary(r: dict, r0: int) -> np.ndarray:
    """출발 ~ t0 요약 10개(SUMMARY_NAMES). 행 0 … r0만 쓴다."""
    r0 = int(r0)
    hr = np.asarray(r['hr5'], np.float64)[:r0 + 1]
    sp = np.asarray(r['sp5'], np.float64)[1:r0 + 1]
    m = np.isfinite(hr)
    out = np.zeros(N_SUMMARY, np.float32)
    out[0] = 5.0 * r0 / 1200.0
    out[1] = _hr(hr[0]) if m[0] else 0.0
    if m.any():
        out[2], out[3], out[4] = _hr(hr[m].max()), _hr(hr[m].mean()), _hr(hr[m].min())
    out[5] = float(np.nanmean(sp)) if len(sp) and np.isfinite(sp).any() else 0.0
    h1 = hr[1:]
    pair = np.isfinite(h1) & np.isfinite(sp)
    out[7] = 1.0
    if pair.sum() >= MIN_PAIRS:
        x, y = sp[pair], h1[pair]
        var = (x * x).mean() - x.mean() ** 2
        if var > MIN_SPEED_VAR:
            out[6] = ((x * y).mean() - x.mean() * y.mean()) / var / 10.0
            out[7] = 0.0
    out[8] = float(r0 == 0)
    return out


def empty() -> tuple:
    """오늘 인코더 입력 비우기(dropout·제거 실험): 84칸 mask 0, 요약 결측."""
    s = np.zeros(N_SUMMARY, np.float32)
    s[SUMMARY_NAMES.index('slope_missing')] = 1.0
    s[SUMMARY_NAMES.index('missing')] = 1.0
    return np.zeros((WINDOW, 4), np.float32), s
