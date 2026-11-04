"""개인 요약 묶음 u (CONTRACT 3.3절).

LightGBM 사본 prerun_lgbm_v1_20261101/vendor/src/history.py의 summarize_arrays·prior_table·aggregate 정의를 그대로
옮겼다(GOOD 값만, float32 변환 뒤 float64). 다른 점(계약 3.3절 표):
- 러닝 수·경과 일수는 log1p.
- 워밍업 곡선은 절대 HR 21칸 대신 '칸 0 대비 상승량' 20칸(30~600초)의 러닝 간 중앙값.
- hr_ref = 앞선 러닝 GOOD HR(정수 반올림)을 합친 분포의 98번째 백분위(nearest-rank). LightGBM에는 없다.
"""
from __future__ import annotations

from dataclasses import dataclass
import warnings

import numpy as np
import pandas as pd

STEP_S = 30
GRID = np.arange(0, 601, STEP_S)            # 0, 30, ..., 600초 (21칸)
WARM_SPEED_S = 300
MIN_PAIRS = 24
MIN_SPEED_VAR = 0.01
PRIOR_K = 5
USABLE = ('CLEAN', 'USABLE_WITH_FLAGS')
HR_BINS = 256
FEATURES = (['log_n_runs', 'log_days_since', 'prev_hr_mean', 'prev_hr_max', 'prev_slope', 'prev_icpt',
             'prev_warm_speed'] + [f'warm_rise_{g}' for g in GRID[1:]])     # v2.1: hr_ref 제외(CONTRACT 3.2절)
N_FEATURES = len(FEATURES)                  # 27
STAT_KEYS = ('pair_n', 's', 'h', 'ss', 'sh', 'hr_n', 'hr_sum')


def _good(values: pd.Series, quality: pd.Series) -> np.ndarray:
    """LightGBM data._good과 같다: GOOD이 아니면 NaN, float32."""
    v = values.to_numpy(dtype=np.float32, na_value=np.nan)
    return np.where((quality == 'GOOD').to_numpy(), v, np.float32(np.nan))


def run_summary(df: pd.DataFrame) -> dict:
    """러닝 하나의 요약. df: elapsed_s, hr_bpm, speed_mps, hr_quality, speed_quality (세션 전체 행)."""
    h = _good(df['hr_bpm'], df['hr_quality']).astype(np.float64)
    s = _good(df['speed_mps'], df['speed_quality']).astype(np.float64)
    e = df['elapsed_s'].to_numpy(dtype=np.float64)
    hv = ~np.isnan(h)
    pv = hv & ~np.isnan(s)
    s0, h0 = np.where(pv, s, 0), np.where(pv, h, 0)
    warm = (e <= WARM_SPEED_S) & ~np.isnan(s)
    out = dict(pair_n=float(pv.sum()), s=float(s0.sum()), h=float(h0.sum()), ss=float((s0 * s0).sum()),
               sh=float((s0 * h0).sum()), hr_n=float(hv.sum()), hr_sum=float(np.where(hv, h, 0).sum()),
               hr_max=float(np.nanmax(h)) if hv.any() else float('nan'))
    with np.errstate(invalid='ignore', divide='ignore'):
        out['warm_speed'] = float(np.where(warm, s, 0).sum() / warm.sum())
    b = np.floor(e / STEP_S + 0.5)                              # 칸 g는 [g − 15, g + 15)초 HR 평균
    m = hv & (b <= GRID[-1] / STEP_S)
    curve = np.full(len(GRID), np.nan)
    if m.any():
        sums = np.bincount(b[m].astype(int), weights=h[m], minlength=len(GRID))[:len(GRID)]
        cnts = np.bincount(b[m].astype(int), minlength=len(GRID))[:len(GRID)]
        with np.errstate(invalid='ignore', divide='ignore'):
            curve = np.where(cnts > 0, sums / cnts, np.nan)
    out['curve'] = curve
    hr_int = np.clip(np.rint(h[hv]), 0, HR_BINS - 1).astype(int)
    out['hr_hist'] = np.bincount(hr_int, minlength=HR_BINS).astype(np.int64)
    return out


@dataclass(frozen=True)
class PriorRun:
    end: float                  # 끝 시각(초, 시작 + duration_s)
    usable: bool                # workout_quality_v1 ∈ USABLE 이고 GOOD HR ≥ 1
    summary: dict


def select_prior(cands, start: float, k: int = PRIOR_K) -> tuple:
    """끝 ≤ 시작인 사용 가능 러닝 중 최근 k개(끝 시각 순)와 gap(초, 없으면 NaN)."""
    ok = sorted((c for c in cands if c.usable and c.end <= start), key=lambda c: c.end)
    picked = ok[-k:] if k else []
    gap = start - picked[-1].end if picked else float('nan')
    return picked, gap


def aggregate(runs, gap_s: float) -> dict:
    """앞선 러닝 요약 목록 → u 원값(결측 NaN). LightGBM aggregate와 같은 순서로 합친다."""
    out = dict(log_n_runs=float(np.log1p(len(runs))), log_days_since=float(np.log1p(gap_s / 86400.0)),
               prev_hr_mean=np.nan, prev_hr_max=np.nan, prev_slope=np.nan, prev_icpt=np.nan,
               prev_warm_speed=np.nan, warm_rise=np.full(len(GRID) - 1, np.nan), hr_ref=np.nan)
    if not runs:
        return out
    v = np.array([[r[k] for k in STAT_KEYS] for r in runs], dtype=np.float64)
    with np.errstate(invalid='ignore', divide='ignore'), warnings.catch_warnings():
        warnings.simplefilter('ignore', category=RuntimeWarning)
        n, cs, ch, css, csh, hr_n, hr_sum = v.sum(axis=0)
        out['prev_hr_mean'] = hr_sum / hr_n
        out['prev_hr_max'] = float(np.nanmedian([r['hr_max'] for r in runs]))
        out['prev_warm_speed'] = float(np.nanmedian([r['warm_speed'] for r in runs]))
        var = css / n - (cs / n) ** 2
        if n >= MIN_PAIRS and var > MIN_SPEED_VAR:
            out['prev_slope'] = (csh / n - cs / n * ch / n) / var
            out['prev_icpt'] = ch / n - out['prev_slope'] * cs / n
        out['warm_rise'] = np.nanmedian(np.stack([r['curve'][1:] - r['curve'][0] for r in runs]), axis=0)
    hist = np.sum([r['hr_hist'] for r in runs], axis=0)
    total = int(hist.sum())
    if total:
        rank = int(np.ceil(0.98 * total))
        out['hr_ref'] = float(np.searchsorted(np.cumsum(hist), rank))
    return out


def vector(raw: dict) -> np.ndarray:
    """원값 dict → FEATURES 순서 27개(float64, 결측 NaN). hr_ref는 계산만 하고 입력에 넣지 않는다."""
    head = [raw[k] for k in FEATURES[:7]]
    return np.array(head + list(raw['warm_rise']), dtype=np.float64)


def identity_stats() -> dict:
    return dict(mean=np.zeros(N_FEATURES), std=np.ones(N_FEATURES))


def normalize(raw: dict, stats: dict) -> tuple:
    """(값 27 float32, 결측 mask 27 bool). 결측 값은 0."""
    x = vector(raw)
    miss = ~np.isfinite(x)
    vals = np.where(miss, 0.0, (x - np.asarray(stats['mean'])) / np.asarray(stats['std']))
    return vals.astype(np.float32), miss


def empty() -> tuple:
    """요약 dropout·결측: 값 0, mask 전부 1."""
    return np.zeros(N_FEATURES, np.float32), np.ones(N_FEATURES, bool)
