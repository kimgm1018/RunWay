"""학습한 LightGBM HR 예측 모델로 개인화 → 예측 → 초기화 (노션 「HR Predictor 테스트」 인계용, 2026-10-29).

    p = HRPredictor("<모델 폴더>")          # model_30s/60s/120s.txt + model_config.json
    p.personalize(support_runs)             # Support 러닝으로 사용자 상태를 만든다(모델 파라미터는 안 바뀜)
    hr = p.predict(batch)                   # [N, 3] = HR@30 / HR@60 / HR@120 (bpm, 절대값)
    p.reset()                               # 다음 사용자 전에 상태를 지운다

개인화 = 같은 사람의 앞선 러닝 최근 5개 요약(history.py prev_* 특징)을 Support로만 만든다. Query 러닝과
앞선 Query 결과는 상태에 넣지 않는다. 상태가 없으면(Cold-start, personalized=False) prev_*는 모두 결측이고,
모델은 학습 때 앞선 러닝이 없던 창과 같은 갈래로 예측한다.

학습 코드(data.make_windows · history.prior_table · features.build_features)와 같은 계산을 쓴다.
check_predictor.py로 학습 경로와 값이 같은지 확인한다.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np

import history as hist
from data import FUTURE, MIN_PAIRS, MIN_SPEED_VAR
from features import HISTORY_VERSIONS, build_features

SECONDS = (30, 60, 120)


class HRPredictor:
    def __init__(self, model_dir: str | Path, num_threads: int = 0):
        model_dir = Path(model_dir)
        path = model_dir / "model_config.json"
        if not path.exists():  # 학습 결과 폴더 그대로 쓸 때(freeze 전)
            path = model_dir / "metrics.json"
        cfg = json.loads(path.read_text(encoding="utf-8"))
        self.config = cfg
        self.version = cfg["features"]
        self.past = cfg["history_cells"]
        self.columns = (model_dir / "features.txt").read_text(encoding="utf-8").split("\n")
        # LightGBM C++은 한글 경로를 직접 열지 못해서 문자열로 읽는다.
        self.models = [lgb.Booster(model_str=(model_dir / f"model_{s}s.txt").read_text(encoding="utf-8"))
                       for s in SECONDS]
        self.num_threads = num_threads
        self.state: dict | None = None

    # ---- 개인화 상태 ----
    def personalize(self, support_runs: list[dict]) -> dict:
        """Support 러닝들로 사용자 상태를 만든다. 이전 상태는 버린다.

        러닝마다 dict: start_time_s(UTC epoch 초), duration_s, elapsed_s[L], hr[L](bpm), speed[L](m/s),
        session_id(선택, 끝 시각이 같을 때 순서). hr·speed는 GOOD 측정값만, 나머지는 NaN.
        """
        rows = []
        for i, r in enumerate(support_runs):
            sid = str(r.get("session_id", i))
            e = np.asarray(r["elapsed_s"], dtype=np.float64)
            summary = hist.summarize_arrays(np.full(len(e), sid), e, np.asarray(r["hr"], dtype=np.float64),
                                            np.asarray(r["speed"], dtype=np.float64))
            v = summary[hist.STATS + hist.CURVE].to_numpy(dtype=np.float64)[0]
            if not v[hist.STATS.index("hr_n")] > 0:  # 학습과 같이 HR이 하나도 없는 러닝은 쓰지 않는다
                continue
            rows.append({"session_id": sid, "end_s": float(r["start_time_s"]) + float(r["duration_s"]),
                         "summary": [None if np.isnan(x) else float(x) for x in v]})
        rows.sort(key=lambda x: (x["end_s"], x["session_id"]))
        self.state = {"version": hist.SUMMARY_VERSION, "runs": rows}
        return self.state

    def reset(self) -> None:
        """사용자 상태를 지운다. 다음 사용자는 personalize()를 다시 부르기 전까지 Cold-start다."""
        self.state = None

    def save_state(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")

    def load_state(self, path: str | Path) -> None:
        self.state = json.loads(Path(path).read_text(encoding="utf-8"))

    # ---- 예측 ----
    def predict(self, batch: dict, personalized: bool = True) -> np.ndarray:
        """[N, 3] 절대 HR(bpm). personalized=False면 상태를 무시한다(Personalization OFF = Cold-start 기본 상태)."""
        X, hr0 = self.features(batch, personalized)
        return self.predict_features(X, hr0)

    def predict_features(self, X, hr0: np.ndarray) -> np.ndarray:
        delta = np.stack([m.predict(X, num_threads=self.num_threads) for m in self.models], axis=1)
        return (hr0[:, None] + delta).astype(np.float64)

    def features(self, batch: dict, personalized: bool = True):
        """batch → 학습과 같은 특징 표(features.txt 순서)와 HR0.

        batch 키 (N = 창 수, L = 이번 러닝 시작부터 t0까지 5초 칸 수, 마지막 칸이 t0):
          hr, speed, grade : [N, L] 배열(앞을 NaN으로 채움) 또는 길이가 다른 1차원 배열 N개. GOOD 값만, 나머지 NaN
          elapsed_s        : [N] t0의 러닝 시작 후 경과 시간(초)
          future_speed     : [N, 24] t0+5초 ~ t0+120초 속도(m/s)
          future_grade     : [N, 24] 같은 칸의 경사(%). 모르면 0(평지)을 넣는다
          session_start_s  : [N] 이번 러닝 시작 시각(UTC epoch 초). 앞선 러닝 선택·경과 일수에 쓴다
          segment          : (선택) hr과 같은 모양의 segment_id. 주면 과거 칸 중 t0와 다른 segment 칸은 결측으로 본다
                             (학습과 같음). 이번 러닝 누적값(run_*)은 segment와 상관없이 처음부터 센다
        """
        hr, sp, gr = (_pad(batch[k]) for k in ("hr", "speed", "grade"))
        n = len(hr)
        past = [_last(x, self.past) for x in (hr, sp, gr)]
        if "segment" in batch:  # 끊긴 곳 앞 segment 칸은 학습에서 결측이었다(data.make_windows)
            seg = _last(_pad(batch["segment"]), self.past)
            for x in past:
                x[seg != seg[:, -1:]] = np.nan
        fs = np.asarray(batch["future_speed"], dtype=np.float32).reshape(n, FUTURE)
        fg = np.asarray(batch["future_grade"], dtype=np.float32).reshape(n, FUTURE)
        w = {"past_hr": past[0], "past_speed": past[1], "past_grade": past[2], "fut_speed": fs, "fut_grade": fg,
             "elapsed_s": np.asarray(batch["elapsed_s"], dtype=np.float64).reshape(n),
             **run_summary(hr, sp)}
        if self.version in HISTORY_VERSIONS:
            start = np.asarray(batch.get("session_start_s", np.full(n, np.nan)), dtype=np.float64).reshape(n)
            w.update(self._prior(start if personalized else None, w["elapsed_s"], n))
        if "gender" in batch:
            w["gender"] = np.asarray(batch["gender"], dtype=np.float32).reshape(n)
        X = build_features(w, self.version)
        if list(X.columns) != self.columns:
            raise ValueError("특징 열이 학습 때와 다릅니다.")
        return X, w["past_hr"][:, -1].astype(np.float64)

    def _prior(self, start, elapsed, n) -> dict:
        """창마다 prev_* 값. 학습(history.prior_table)과 같이 지금 러닝 시작 전에 끝난 Support 러닝 최근 PRIOR_K개."""
        runs = (self.state or {}).get("runs", []) if start is not None else []
        ends = np.array([r["end_s"] for r in runs], dtype=np.float64)
        vals = np.array([[np.nan if x is None else x for x in r["summary"]] for r in runs], dtype=np.float64)
        out = {k: np.full(n, np.nan) for k in hist.PRIOR_KEYS}
        curves = np.full((n, len(hist.GRID)), np.nan)
        cache = {}
        for i in range(n):
            # 시작 시각을 모르면 Support 전체를 앞선 러닝으로 본다(경과 일수는 결측).
            hi = len(runs) if start is None or np.isnan(start[i]) else int(np.searchsorted(ends, start[i], "right"))
            if hi not in cache:
                cache[hi] = hist.aggregate(vals[max(0, hi - hist.PRIOR_K):hi], np.nan)
            one, curves[i] = cache[hi]
            for k in hist.PRIOR_KEYS:
                out[k][i] = one[k]
            if hi and start is not None:
                out["prev_days_since"][i] = (start[i] - ends[hi - 1]) / 86400
        res = {k: v.astype(np.float32) for k, v in out.items()}
        for d in hist.LEADS:
            res[f"prev_warm_hr_{d}"] = hist._interp(curves, elapsed + d).astype(np.float32)
        return res


def run_summary(hr: np.ndarray, sp: np.ndarray) -> dict:
    """이번 러닝 처음부터 t0까지(포함)의 누적 요약. data._RunState와 같은 값(run_* 특징)."""
    hr = hr.astype(np.float64)
    sp = sp.astype(np.float64)
    hv = ~np.isnan(hr)
    pv = hv & ~np.isnan(sp)
    s0, h0 = np.where(pv, sp, 0), np.where(pv, hr, 0)
    n, cs, ch = pv.sum(axis=1), s0.sum(axis=1), h0.sum(axis=1)
    css, csh = (s0 * s0).sum(axis=1), (s0 * h0).sum(axis=1)
    hr_n = hv.sum(axis=1)
    first = np.where(hv.any(axis=1), hr[np.arange(len(hr)), hv.argmax(axis=1)], np.nan)
    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        var = css / n - (cs / n) ** 2
        slope = (csh / n - cs / n * ch / n) / var
        ok = (n >= MIN_PAIRS) & (var > MIN_SPEED_VAR)
        slope = np.where(ok, slope, np.nan)
        out = {"run_hr_max": np.nanmax(hr, axis=1), "run_hr_min": np.nanmin(hr, axis=1),
               "run_hr_mean": np.where(hr_n > 0, np.where(hv, hr, 0).sum(axis=1) / hr_n, np.nan),
               "run_hr_first": first, "run_pair_n": n, "run_slope": slope,
               "run_icpt": np.where(ok, ch / n - slope * cs / n, np.nan)}
    return {k: np.asarray(v, dtype=np.float32) for k, v in out.items()}


def _pad(x) -> np.ndarray:
    """[N, L] 배열 또는 길이가 다른 1차원 배열 목록 → 앞을 NaN으로 채운 [N, Lmax] float32."""
    if isinstance(x, np.ndarray) and x.ndim == 2:
        return x.astype(np.float32)
    rows = [np.asarray(r, dtype=np.float32) for r in x]
    out = np.full((len(rows), max(len(r) for r in rows)), np.nan, dtype=np.float32)
    for i, r in enumerate(rows):
        out[i, out.shape[1] - len(r):] = r
    return out


def _last(x: np.ndarray, k: int) -> np.ndarray:
    """마지막 k칸. 모자라면 앞을 NaN으로 채운다(학습의 러닝 시작 앞 칸과 같다)."""
    if x.shape[1] >= k:
        return x[:, -k:].copy()
    return np.concatenate([np.full((len(x), k - x.shape[1]), np.nan, dtype=x.dtype), x], axis=1)
