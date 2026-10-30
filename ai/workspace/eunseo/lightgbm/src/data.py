"""FitRec V1.1 → LightGBM 학습 샘플.

노션 「Input/Output」 GRU 입력 형식과 같은 문제를 만든다.
5초 간격, 과거 24칸(현재 포함, past로 바꿀 수 있음) HR·Speed·Grade + 앞으로 24칸 Speed·Grade,
정답은 30·60·120초 뒤 HR의 현재 대비 변화량. 품질이 GOOD이 아닌 값은 결측으로 둔다.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds

PAST = 24
FUTURE = 24
HORIZONS = (6, 12, 24)
STRIDE = 6
USABLE = ("CLEAN", "USABLE_WITH_FLAGS")
COLUMNS = ["session_id", "segment_id", "elapsed_s", "hr_bpm", "speed_mps", "grade_observed_pct",
           "hr_quality", "speed_quality", "grade_quality"]


def canonical_dir(data_dir: Path) -> Path:
    return Path(data_dir) / "data" / "canonical" / "fitrec_v1"


def load_split(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def select_sessions(sessions: pd.DataFrame, split: dict, name: str, *, frac: float = 1.0,
                    seed: int = 42, eval_only: bool = False) -> pd.DataFrame:
    """분할 이름(train/val/test)에 속한 사용 가능 러닝. frac<1이면 사람 묶음 단위로 뽑는다."""
    members = {m: g for g, ms in split["group_members"].items() for m in ms}
    groups = sorted(split[name])
    if frac < 1.0:
        rng = np.random.default_rng(seed)
        k = max(1, round(len(groups) * frac))
        groups = sorted(rng.choice(groups, size=k, replace=False).tolist())
    out = sessions[sessions["workout_quality_v1"].isin(USABLE)].copy()
    out["subject_group"] = out["subject_id"].map(lambda s: members.get(s, s))
    out = out[out["subject_group"].isin(set(groups))]
    if "cohorts" in split:  # Split V2: 사람 묶음 안 러닝을 시간순으로 나누는 규칙(contract)을 따른다
        out = _v2_roles(out, split, name)
        if eval_only:
            out = out[out["v2_query"]]
    elif eval_only:
        out = out[out["session_id"].isin(set(split["eval_windows"][name]["eval_session_ids"]))]
    return out


def _v2_roles(out: pd.DataFrame, split: dict, name: str) -> pd.DataFrame:
    """Split V2 contract. 러닝을 사람 묶음마다 (start_time_utc, session_id) 순으로 세운다.

    train: N>=2면 앞 floor(0.8N)개는 학습, 나머지는 Train Temporal Holdout(v2_holdout, early stopping용). N=1은 학습.
    val/test: personalized는 가장 최근 max(1, ceil(0.2N))개가 평가(query), 나머지는 앞선 러닝(support)으로만 쓴다.
    cold start(N=1)는 그 러닝 하나가 평가 대상이다.
    """
    out = out.sort_values(["subject_group", "start_time_utc", "session_id"]).copy()
    rank = out.groupby("subject_group").cumcount().to_numpy()
    n = out.groupby("subject_group")["session_id"].transform("size").to_numpy()
    if name == "train":
        out["v2_holdout"] = (n >= 2) & (rank >= np.floor(0.8 * n))
    else:
        is_cold = out["subject_group"].isin(set(split["cohorts"][f"cold_start_{name}"])).to_numpy()
        out["cohort"] = np.where(is_cold, "cold_start", "personalized")
        out["v2_query"] = is_cold | (rank >= n - np.maximum(1, np.ceil(0.2 * n)))
    return out


def read_timeseries(data_dir: Path, sessions: pd.DataFrame) -> pd.DataFrame:
    root = canonical_dir(data_dir) / "timeseries"
    files = [str(root / f) for f in sorted(sessions["part_file"].unique())]
    table = ds.dataset(files, format="parquet").to_table(
        columns=COLUMNS, filter=ds.field("session_id").isin(sessions["session_id"].tolist()))
    # 문자열 열은 범주형으로 읽어야 train 전체(약 3,200만 행)도 메모리에 들어간다.
    return table.to_pandas(strings_to_categorical=True)


def _good(values: pd.Series, quality: pd.Series) -> np.ndarray:
    v = values.to_numpy(dtype=np.float32, na_value=np.nan)
    return np.where((quality == "GOOD").to_numpy(), v, np.float32(np.nan))


RUN_KEYS = ("run_hr_max", "run_hr_min", "run_hr_mean", "run_hr_first", "run_pair_n", "run_slope", "run_icpt")
MIN_PAIRS = 24          # HR-속도 관계를 구하는 최소 칸 수 (2분)
MIN_SPEED_VAR = 0.01    # 속도가 거의 일정하면 기울기를 구하지 않는다 ((m/s)^2)


class _RunState:
    """같은 러닝(session)의 처음부터 지금까지 누적값. segment가 바뀌어도 이어 간다."""

    def __init__(self):
        self.hr_max = self.hr_min = self.hr_first = np.nan
        self.hr_n = self.hr_sum = 0.0
        self.n = self.s = self.h = self.ss = self.sh = 0.0

    def run(self, h: np.ndarray, s: np.ndarray, t: np.ndarray) -> dict:
        """segment 안 칸 h·s를 누적하고, 기준 칸 t 시점(t 포함)의 요약을 돌려준다."""
        hv = ~np.isnan(h)
        h0 = np.where(hv, h, 0).astype(np.float64)
        hr_n = self.hr_n + np.cumsum(hv)
        hr_sum = self.hr_sum + np.cumsum(h0)
        hr_max = np.fmax.accumulate(np.r_[self.hr_max, h])[1:]
        hr_min = np.fmin.accumulate(np.r_[self.hr_min, h])[1:]
        if np.isnan(self.hr_first) and hv.any():
            self.hr_first = float(h[hv][0])  # 기준 칸은 HR이 GOOD이라 첫 HR은 항상 그 이전(포함)에 있다

        pv = hv & ~np.isnan(s)
        s0 = np.where(pv, s, 0).astype(np.float64)
        hp = np.where(pv, h0, 0)
        n = self.n + np.cumsum(pv)
        cs, ch = self.s + np.cumsum(s0), self.h + np.cumsum(hp)
        css, csh = self.ss + np.cumsum(s0 * s0), self.sh + np.cumsum(s0 * hp)

        self.hr_n, self.hr_sum = hr_n[-1], hr_sum[-1]
        self.hr_max, self.hr_min = hr_max[-1], hr_min[-1]
        self.n, self.s, self.h, self.ss, self.sh = n[-1], cs[-1], ch[-1], css[-1], csh[-1]

        n, cs, ch, css, csh = n[t], cs[t], ch[t], css[t], csh[t]
        with np.errstate(invalid="ignore", divide="ignore"):
            var = css / n - (cs / n) ** 2
            slope = (csh / n - cs / n * ch / n) / var
            ok = (n >= MIN_PAIRS) & (var > MIN_SPEED_VAR)
            slope = np.where(ok, slope, np.nan)
            icpt = np.where(ok, ch / n - slope * cs / n, np.nan)
            mean = np.where(hr_n[t] > 0, hr_sum[t] / hr_n[t], np.nan)
        out = {"run_hr_max": hr_max[t], "run_hr_min": hr_min[t], "run_hr_mean": mean,
               "run_hr_first": np.full(len(t), self.hr_first),
               "run_pair_n": n, "run_slope": slope, "run_icpt": icpt}
        return {k: np.asarray(v, dtype=np.float32) for k, v in out.items()}


def make_windows(ts: pd.DataFrame, *, stride: int = STRIDE, past: int = PAST,
                 require_all_targets: bool = False) -> dict:
    """segment(끊긴 곳마다 새 구간) 안에서만 창을 자른다. 기준 시점 HR이 GOOD이어야 한다.

    past는 과거 칸 수(현재 포함). segment 앞쪽에서 모자라는 칸은 결측이라 창 수는 past와 상관없다.

    run_* 값은 같은 러닝의 처음부터 기준 시점까지(포함) 누적한 요약이라 미래 칸을 쓰지 않는다.
    """
    ts = ts.sort_values(["session_id", "segment_id", "elapsed_s"], kind="stable")
    hr = _good(ts["hr_bpm"], ts["hr_quality"])
    speed = _good(ts["speed_mps"], ts["speed_quality"])
    grade = _good(ts["grade_observed_pct"], ts["grade_quality"])
    sid = ts["session_id"].astype("category")
    names, keys = sid.cat.categories.to_numpy(), sid.cat.codes.to_numpy()
    seg = ts["segment_id"].to_numpy()
    elapsed = ts["elapsed_s"].to_numpy(dtype=np.float64)
    bounds = np.flatnonzero((keys[1:] != keys[:-1]) | (seg[1:] != seg[:-1])) + 1
    starts = np.r_[0, bounds]
    ends = np.r_[bounds, len(ts)]

    out = {k: [] for k in ("past_hr", "past_speed", "past_grade", "fut_speed", "fut_grade", "y",
                           "session_id", "elapsed_s", *RUN_KEYS)}
    pad_l = np.full(past - 1, np.nan, dtype=np.float32)
    pad_r = np.full(FUTURE, np.nan, dtype=np.float32)
    state, prev_key = None, None
    for a, b in zip(starts, ends):
        if keys[a] != prev_key:
            state, prev_key = _RunState(), keys[a]
        t = np.arange(0, b - a, stride)
        h, s, g = hr[a:b], speed[a:b], grade[a:b]
        t = t[~np.isnan(h[t])]
        run = state.run(h, s, t)  # 창이 없는 segment도 누적에는 넣는다
        if not len(t):
            continue
        hp, sp, gp = (np.r_[pad_l, x, pad_r] for x in (h, s, g))
        past_idx = t[:, None] + np.arange(past)              # padded index of t-(past-1)..t
        fut_idx = t[:, None] + past + np.arange(FUTURE)      # padded index of t+1..t+24
        now = h[t]
        y = np.stack([hp[t + past - 1 + k] - now for k in HORIZONS], axis=1)
        keep = ~np.isnan(y).all(axis=1) if not require_all_targets else ~np.isnan(y).any(axis=1)
        if not keep.any():
            continue
        t, past_idx, fut_idx, y = t[keep], past_idx[keep], fut_idx[keep], y[keep]
        out["past_hr"].append(hp[past_idx])
        out["past_speed"].append(sp[past_idx])
        out["past_grade"].append(gp[past_idx])
        out["fut_speed"].append(sp[fut_idx])
        out["fut_grade"].append(gp[fut_idx])
        out["y"].append(y)
        out["session_id"].append(names[keys[a + t]])
        out["elapsed_s"].append(elapsed[a + t])
        for k in RUN_KEYS:
            out[k].append(run[k][keep])
    if not out["y"]:
        raise ValueError("만들어진 샘플이 없습니다.")
    return {k: np.concatenate(v) for k, v in out.items()}


GENDER = {"female": 1.0, "male": 0.0}  # unknown은 결측


def gender_of(session_id: np.ndarray, sessions: pd.DataFrame) -> np.ndarray:
    """창마다 그 러닝 사람의 성별(여 1 · 남 0 · 모름 결측). 사람 정보 중 FitRec에 값이 있는 것은 성별뿐이다."""
    g = sessions.set_index("session_id")["gender"].map(GENDER)
    return g.reindex(session_id).to_numpy(dtype=np.float32)


def build(data_dir: Path, split: dict, name: str, *, frac: float = 1.0, seed: int = 42,
          eval_only: bool = False, stride: int = STRIDE, past: int = PAST, require_all_targets: bool = False,
          history: bool = False, support_only: bool = False):
    """history=True면 같은 사람의 앞선 러닝 요약(prev_*, features_v4)을 붙인다. support_only는 history.load_prior 참고."""
    sessions = pd.read_parquet(canonical_dir(data_dir) / "sessions.parquet")
    chosen = select_sessions(sessions, split, name, frac=frac, seed=seed, eval_only=eval_only)
    windows = make_windows(read_timeseries(data_dir, chosen), stride=stride, past=past,
                           require_all_targets=require_all_targets)
    windows["gender"] = gender_of(windows["session_id"], chosen)
    if history:
        import history as hist
        windows.update(hist.attach(windows, data_dir, split, support_only=support_only))
    return windows, chosen


def iter_build(data_dir: Path, split: dict, name: str, *, frac: float = 1.0, seed: int = 42,
               eval_only: bool = False, stride: int = STRIDE, past: int = PAST, require_all_targets: bool = False,
               history: bool = False, chunk_sessions: int = 2000, support_only: bool = False):
    """build()와 같은 창을 러닝 chunk_sessions개씩 같은 순서로 나눠 돌려준다(train 100% 메모리 절약).

    make_windows와 같은 순서로 정렬한 뒤 러닝 경계에서만 자르므로, 나눈 결과를 이어 붙이면 build()와 같다.
    """
    sessions = pd.read_parquet(canonical_dir(data_dir) / "sessions.parquet")
    chosen = select_sessions(sessions, split, name, frac=frac, seed=seed, eval_only=eval_only)
    ts = read_timeseries(data_dir, chosen).sort_values(["session_id", "segment_id", "elapsed_s"], kind="stable")
    keys = ts["session_id"].astype("category").cat.codes.to_numpy()
    starts = np.r_[0, np.flatnonzero(keys[1:] != keys[:-1]) + 1, len(ts)]
    prior = None
    if history:
        import history as hist
        prior = hist.load_prior(data_dir, split, support_only)

    def chunks():
        for i in range(0, len(starts) - 1, chunk_sessions):
            part = ts.iloc[starts[i]:starts[min(i + chunk_sessions, len(starts) - 1)]]
            windows = make_windows(part, stride=stride, past=past, require_all_targets=require_all_targets)
            windows["gender"] = gender_of(windows["session_id"], chosen)
            if history:
                windows.update(hist.attach(windows, data_dir, split, prior))
            yield windows

    return chunks(), chosen


def trim_past(windows: dict, past: int) -> dict:
    """더 길게 만든 창에서 과거 마지막 past칸만 남긴다(make_windows(past=past)와 같은 값)."""
    out = dict(windows)
    for k in ("past_hr", "past_speed", "past_grade"):
        out[k] = windows[k][:, -past:]
    return out
