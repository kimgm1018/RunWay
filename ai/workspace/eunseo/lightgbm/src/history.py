"""같은 사람의 앞선 러닝 요약 (features_v4용).

러닝 0~5분은 과거 120초 창과 이번 러닝 누적값(v3)이 같은 정보라 오차가 줄지 않았다(2026-10-26).
그래서 같은 사람 묶음의 앞선 러닝에서 평소 워밍업 HR 모양과 HR-속도 관계를 가져온다.

- 러닝 요약: GOOD 값만으로 경과 시간 30초 칸별 평균 HR(0~600초), 0~300초 평균 속도,
  HR-속도 직선을 구할 합계(n, Σs, Σh, Σs², Σsh), 평균·최대 HR.
- 앞선 러닝: 같은 사람 묶음의 사용 가능 러닝 중 **지금 러닝 시작 전에 끝난 것**의 최근 PRIOR_K개.
  시작 시각이 같거나 겹치는 러닝은 쓰지 않는다. 지금 러닝 자체와 미래 러닝은 절대 들어가지 않는다.
- 묶음은 train/val/test를 넘나들지 않으므로 다른 분할의 러닝도 들어가지 않는다.
"""
from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds

from data import MIN_PAIRS, MIN_SPEED_VAR, USABLE, _good, canonical_dir

SUMMARY_VERSION = "session_summary_v1"
PRIOR_K = 5
STEP_S = 30
GRID = np.arange(0, 601, STEP_S)          # 워밍업 곡선 칸: 0, 30, ..., 600초
WARM_SPEED_S = 300
LEADS = (0, 30, 60, 120)                  # 지금, 30·60·120초 뒤의 평소 HR
CURVE = [f"warm_hr_{g}" for g in GRID]
STATS = ["pair_n", "s", "h", "ss", "sh", "hr_n", "hr_sum", "hr_max", "warm_speed"]
PREV_KEYS = ("prev_n_runs", "prev_days_since", "prev_hr_mean", "prev_hr_max", "prev_slope", "prev_icpt",
             "prev_warm_speed", *(f"prev_warm_hr_{d}" for d in LEADS))


def _summarize(ts: pd.DataFrame) -> pd.DataFrame:
    h = _good(ts["hr_bpm"], ts["hr_quality"]).astype(np.float64)
    s = _good(ts["speed_mps"], ts["speed_quality"]).astype(np.float64)
    e = ts["elapsed_s"].to_numpy(dtype=np.float64)
    sid = ts["session_id"].astype(str).to_numpy()
    return summarize_arrays(sid, e, h, s)


def summarize_arrays(sid: np.ndarray, e: np.ndarray, h: np.ndarray, s: np.ndarray) -> pd.DataFrame:
    """러닝 요약(1러닝 = 1행, STATS + CURVE). h·s는 GOOD 값만 남기고 나머지는 결측(NaN)."""
    hv = ~np.isnan(h)
    pv = hv & ~np.isnan(s)
    s0, h0 = np.where(pv, s, 0), np.where(pv, h, 0)
    warm = (e <= WARM_SPEED_S) & ~np.isnan(s)
    df = pd.DataFrame({"session_id": sid, "pair_n": pv.astype(float), "s": s0, "h": h0, "ss": s0 * s0,
                       "sh": s0 * h0, "hr_n": hv.astype(float), "hr_sum": np.where(hv, h, 0),
                       "hr_max": h, "warm_s": np.where(warm, s, 0), "warm_n": warm.astype(float)})
    g = df.groupby("session_id", sort=False)
    out = g[["pair_n", "s", "h", "ss", "sh", "hr_n", "hr_sum", "warm_s", "warm_n"]].sum()
    out["hr_max"] = g["hr_max"].max()
    with np.errstate(invalid="ignore", divide="ignore"):
        out["warm_speed"] = out.pop("warm_s") / out.pop("warm_n")

    b = np.floor(e / STEP_S + 0.5)                # 칸 g는 [g−15, g+15)초 HR 평균
    m = hv & (b <= GRID[-1] / STEP_S)
    curve = (pd.DataFrame({"session_id": sid[m], "bin": b[m].astype(int), "hr": h[m]})
             .groupby(["session_id", "bin"])["hr"].mean().unstack())
    curve = curve.reindex(columns=range(len(GRID)))
    curve.columns = CURVE
    return out.join(curve)


def session_summary(data_dir: Path) -> pd.DataFrame:
    """모든 러닝의 요약. 처음 한 번 만들어 data 폴더 안에 저장한다(팀 저장소 밖)."""
    path = Path(data_dir) / "derived" / f"{SUMMARY_VERSION}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    root = canonical_dir(data_dir) / "timeseries"
    cols = ["session_id", "elapsed_s", "hr_bpm", "speed_mps", "hr_quality", "speed_quality"]
    parts = [_summarize(ds.dataset(str(f), format="parquet").to_table(columns=cols)
                        .to_pandas(strings_to_categorical=True))
             for f in sorted(root.glob("part-*.parquet"))]
    out = pd.concat(parts)
    if out.index.duplicated().any():  # 한 러닝이 두 파일에 나뉘어 있으면 합계가 틀린다
        raise ValueError("러닝 하나가 여러 part 파일에 걸쳐 있습니다.")
    path.parent.mkdir(parents=True, exist_ok=True)
    out.reset_index().to_parquet(path, index=False)
    return out.reset_index()


def prior_table(sessions: pd.DataFrame, summary: pd.DataFrame, split: dict,
                exclude: frozenset = frozenset()) -> pd.DataFrame:
    """러닝마다 앞선 러닝 PRIOR_K개를 모은 값(러닝 1개 = 1행). exclude 러닝은 앞선 러닝으로 쓰지 않는다."""
    members = {m: g for g, ms in split["group_members"].items() for m in ms}
    s = sessions[["session_id", "subject_id", "workout_quality_v1", "start_time_utc", "duration_s"]].copy()
    s["group"] = s["subject_id"].map(lambda x: members.get(x, x))
    s["start"] = (s["start_time_utc"] - pd.Timestamp(0, tz="UTC")).dt.total_seconds()
    s["end"] = s["start"] + s["duration_s"]
    s = s.merge(summary, on="session_id", how="left").sort_values(["group", "end", "session_id"])
    vals = s[STATS + CURVE].to_numpy(dtype=np.float64)
    rows = []
    for _, g in s.groupby("group", sort=False):
        usable = (g["workout_quality_v1"].isin(USABLE).to_numpy() & (g["hr_n"].to_numpy() > 0)
                  & ~g["session_id"].isin(exclude).to_numpy())
        ends, idx = g["end"].to_numpy()[usable], np.flatnonzero(usable)
        pos = s.index.get_indexer(g.index)
        for sid, start, hi in zip(g["session_id"], g["start"],
                                  np.searchsorted(ends, g["start"].to_numpy(), side="right")):
            take = pos[idx[max(0, hi - PRIOR_K):hi]]
            rows.append((sid, take, start - ends[hi - 1] if hi else np.nan))
    out = {k: np.full(len(rows), np.nan) for k in PRIOR_KEYS}
    curves = np.full((len(rows), len(GRID)), np.nan)
    for r, (_, take, gap) in enumerate(rows):
        one, curves[r] = aggregate(vals[take], gap)
        for k in PRIOR_KEYS:
            out[k][r] = one[k]
    df = pd.DataFrame(out, index=[sid for sid, _, _ in rows])
    df[CURVE] = curves
    return df


PRIOR_KEYS = ("prev_n_runs", "prev_days_since", "prev_hr_mean", "prev_hr_max", "prev_slope", "prev_icpt",
              "prev_warm_speed")


def aggregate(v: np.ndarray, gap: float) -> tuple[dict, np.ndarray]:
    """앞선 러닝 요약 행들(v: STATS + CURVE 순서, 최근 PRIOR_K개)을 합친 prev_* 값과 워밍업 곡선.

    gap = 지금 러닝 시작 − 마지막 앞선 러닝 끝(초). 앞선 러닝이 없으면 prev_n_runs 0, 나머지는 결측.
    """
    out = dict.fromkeys(PRIOR_KEYS, np.nan)
    out["prev_n_runs"] = len(v)
    out["prev_days_since"] = gap / 86400
    curve = np.full(len(GRID), np.nan)
    if not len(v):
        return out, curve
    col = {c: i for i, c in enumerate(STATS + CURVE)}
    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)  # 앞선 러닝 모두 그 칸이 빈 경우
        tot = v[:, :7].sum(axis=0)  # pair_n, s, h, ss, sh, hr_n, hr_sum를 합쳐 한 직선으로 맞춘다
        n, cs, ch, css, csh, hr_n, hr_sum = tot
        out["prev_hr_mean"] = hr_sum / hr_n
        out["prev_hr_max"] = np.nanmedian(v[:, col["hr_max"]])
        out["prev_warm_speed"] = np.nanmedian(v[:, col["warm_speed"]])
        var = css / n - (cs / n) ** 2
        if n >= MIN_PAIRS and var > MIN_SPEED_VAR:
            out["prev_slope"] = (csh / n - cs / n * ch / n) / var
            out["prev_icpt"] = ch / n - out["prev_slope"] * cs / n
        curve = np.nanmedian(v[:, col[CURVE[0]]:], axis=0)
    return out, curve


def load_prior(data_dir: Path, split: dict, support_only: bool = False) -> pd.DataFrame:
    """support_only=True면 HR Predictor 테스트처럼 사람마다 뒤 20% 러닝(train holdout · val Query)을 앞선 러닝에서
    뺀다. 그 러닝들은 앞 80%(Support)만 앞선 러닝으로 보고, 앞선 Query 러닝은 쓰지 않는다(2026-10-30)."""
    sessions = pd.read_parquet(canonical_dir(data_dir) / "sessions.parquet")
    exclude = query_sessions(sessions, split) if support_only else frozenset()
    return prior_table(sessions, session_summary(data_dir), split, exclude)


def query_sessions(sessions: pd.DataFrame, split: dict) -> frozenset:
    """Split V2 train holdout + val Query 러닝. test는 열지 않는다."""
    if "cohorts" not in split:
        raise ValueError("support_only는 Split V2(cohorts가 있는 분할)에서만 쓴다.")
    import data
    tr = data.select_sessions(sessions, split, "train")
    va = data.select_sessions(sessions, split, "val")
    return frozenset(tr.loc[tr["v2_holdout"], "session_id"]) | frozenset(va.loc[va["v2_query"], "session_id"])


def attach(w: dict, data_dir: Path, split: dict, prior: pd.DataFrame | None = None,
           support_only: bool = False) -> dict:
    """창마다 prev_* 값을 붙인다. 워밍업 곡선은 지금 경과 시간과 30·60·120초 뒤 값으로 읽는다.

    나눠 만들 때는 load_prior()로 한 번 만든 표를 prior로 넘긴다.
    """
    if prior is None:
        prior = load_prior(data_dir, split, support_only)
    rows = prior.index.get_indexer(w["session_id"])
    if (rows < 0).any():
        raise ValueError("앞선 러닝 표에 없는 러닝이 있습니다.")
    p = prior.iloc[rows]
    out = {k: p[k].to_numpy(dtype=np.float32) for k in PREV_KEYS if not k.startswith("prev_warm_hr_")}
    curves = p[CURVE].to_numpy(dtype=np.float64)
    for d in LEADS:
        out[f"prev_warm_hr_{d}"] = _interp(curves, w["elapsed_s"] + d).astype(np.float32)
    return out


def _interp(curves: np.ndarray, t: np.ndarray) -> np.ndarray:
    """칸 사이는 직선으로 잇는다. 600초를 넘거나 양쪽 칸 중 하나가 비면 결측."""
    x = np.asarray(t, dtype=np.float64) / STEP_S
    lo = np.floor(x).astype(int)
    ok = (x >= 0) & (x <= len(GRID) - 1)
    lo = np.clip(lo, 0, len(GRID) - 2)
    r = np.arange(len(x))
    a, b = curves[r, lo], curves[r, lo + 1]
    f = x - lo
    v = np.where(f == 0, a, a + (b - a) * f)
    return np.where(ok, v, np.nan)
