"""특징 v1 (features_v1) · v2 (features_v2).

v1: 과거 24칸은 원값 + 요약값, 앞으로 24칸은 요약값만 쓴다. 서비스에서는 후보 페이스 하나를
24칸에 같은 값으로 채우므로, 학습에서도 평균·최대 같은 요약으로 넣어 입력 차이를 줄인다.
개인화 값과 경과 시간은 GRU와 같은 조건을 맞추려고 v1에서 쓰지 않는다.

v2: v1 + 경과 시간·유효 칸 수(러닝 초반 대응) + HR 노이즈 대응(중앙값 평활, 5초 최대 변화,
결측 칸 수). 2026-10-26 EXP-20261023-02 오차 분석에서 러닝 초반과 HR이 튀는 창의 오차가 컸다.

v3: v2 + 이번 러닝 처음부터 지금까지의 HR 요약과 HR-속도 관계(data.py run_* 값). 과거 120초만으로는
속도가 바뀔 때 HR이 어디에 자리 잡을지 몰라 큰 HR 변화를 작게 예측했다(2026-10-26 EXP-06~09).
러닝 시작 2분 안에서는 과거 24칸과 같은 정보라 효과를 기대하지 않는다.

v4: v3 + 같은 사람의 앞선 러닝 최근 5개(history.py prev_* 값). 평소 워밍업 HR 곡선으로 본 지금·30·60·120초 뒤
HR과 그 차이, 앞선 러닝의 HR-속도 관계로 본 HR. 러닝 0~5분은 v2·v3로 줄지 않았다(2026-10-26 EXP-12).

v5: v4 + 앞으로 속도의 모양(최저 속도, 느린 칸 수·처음 느려지는 칸, 각 시점 직전 30초 평균). HR 20bpm 넘게
떨어지는 창의 절반은 앞으로 120초 안에 멈추거나 걷는데, 평균 속도에 묻혀 하락을 작게 예측했다(2026-10-27).
서비스는 후보 페이스 하나로 24칸을 채우므로 이 특징은 "멈춤·걷기 입력이 있으면" 얼마나 나아지는지 보는 용도다.

v6: v4 + 과거 노력 정점·회복, 노력으로 설명 안 되는 HR 상승, 결측을 건너 본 HR 끊김. 속도가 그대로인데 HR이
20bpm 넘게 떨어지는 창의 절반 이상이 오르막·속도 서지·HR 솟음 뒤 회복이고, 과거 HR 끊김(결측 건너 15bpm+)이
대조군의 10배였다(2026-10-27 EXP-20261027-03 hr_drop_analysis.md). 노력 = 경사 보정 속도, 앞으로는 v1처럼
평균 속도·평균 경사만 써서 서비스의 "후보 페이스 하나" 입력과 같게 둔다. v5 특징은 넣지 않는다.

v7: v6 + 앞으로 24칸 속도 원값(fut_speed_c0~c23, 5초마다 실제 속도). 다른 모델(GRU·Transformer)처럼 미래 속도를
5초 칸별로 받는 입력 조건에서 비교하기 위한 버전이다(2026-10-29). 서비스가 후보 페이스 하나만 주면 24칸이 같은 값이 된다.

v8: v7 + 성별(gender_female, 여 1 · 남 0 · 모름 결측). FitRec에는 나이·체중·안정시/최대 심박 값이 없고
성별만 있다(subjects.parquet rhr_bpm·hrmax_est_bpm은 모두 비어 있음). 앞선 러닝이 없는 새 사용자에게 도움이 되는지 본다(2026-10-29).

과거 길이(칸 수)는 바꿀 수 있다(train_lgbm.py --history-cells). 과거 요약은 past_windows(n) 칸으로 하고,
이름에 _24가 붙은 v6 노력 특징(eff_peak_drop_24 등)은 과거 전체를 쓴다. 기본 24칸이면 열·값이 예전과 같다.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

VERSION = "features_v1"
VERSIONS = ("features_v1", "features_v2", "features_v3", "features_v4", "features_v5", "features_v6", "features_v7",
            "features_v8")
HISTORY_VERSIONS = ("features_v4", "features_v5", "features_v6", "features_v7", "features_v8")  # 앞선 러닝 요약(history.py)이 필요한 버전
WINDOWS = (6, 12, 24)
JUMP_BPM = 5
SLOW_MPS = 1.0  # 이보다 느리면 멈춤·걷기로 본다
GRADE_COST = 0.033  # 경사 1%당 노력 증가(일반적인 GAP 근사, val로 맞추지 않음)
BIG_JUMP_BPM = 15


def past_windows(n: int) -> tuple:
    """과거 요약에 쓰는 칸 수: WINDOWS 중 과거 길이 n 이하 + n. 미래 요약은 항상 WINDOWS."""
    return tuple(sorted({k for k in WINDOWS if k <= n} | {n}))


def _nan(fn, a, **kw):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        return fn(a, **kw)


def build_features(w: dict, version: str = VERSION) -> pd.DataFrame:
    if version not in VERSIONS:
        raise ValueError(f"모르는 특징 버전: {version}")
    hr, sp, gr = w["past_hr"], w["past_speed"], w["past_grade"]
    fs, fg = w["fut_speed"], w["fut_grade"]
    n = hr.shape[1]
    cols = {}
    for name, arr in (("hr", hr), ("speed", sp), ("grade", gr)):
        for lag in range(n):
            cols[f"{name}_lag{lag}"] = arr[:, n - 1 - lag]
    hr_now, sp_now = hr[:, -1], sp[:, -1]
    pw = past_windows(n)
    for k in sorted({*pw, *WINDOWS}):  # 과거 24칸이면 예전과 같은 열 순서
        if k in pw:
            cols[f"hr_mean_{k}"] = _nan(np.nanmean, hr[:, -k:], axis=1)
            cols[f"hr_std_{k}"] = _nan(np.nanstd, hr[:, -k:], axis=1)
            cols[f"hr_diff_{k}"] = hr_now - hr[:, -k]
            cols[f"speed_mean_{k}"] = _nan(np.nanmean, sp[:, -k:], axis=1)
            cols[f"speed_diff_{k}"] = sp_now - sp[:, -k]
        if k not in WINDOWS:
            continue
        cols[f"fut_speed_mean_{k}"] = _nan(np.nanmean, fs[:, :k], axis=1)
        cols[f"fut_grade_mean_{k}"] = _nan(np.nanmean, fg[:, :k], axis=1)
        cols[f"fut_grade_max_{k}"] = _nan(np.nanmax, fg[:, :k], axis=1)
        cols[f"fut_speed_delta_{k}"] = cols[f"fut_speed_mean_{k}"] - sp_now
    if version != "features_v1":
        cols.update(_v2(w, hr, sp, gr, fs, fg))
    if version in ("features_v3", *HISTORY_VERSIONS):
        cols.update(_v3(w, cols))
    if version in HISTORY_VERSIONS:
        cols.update(_v4(w, cols))
    if version == "features_v5":
        cols.update(_v5(fs, cols))
    if version in ("features_v6", "features_v7", "features_v8"):
        cols.update(_v6(w, hr, sp, gr, cols))
    if version in ("features_v7", "features_v8"):
        cols.update({f"fut_speed_c{i}": fs[:, i] for i in range(fs.shape[1])})
    if version == "features_v8":
        cols["gender_female"] = w["gender"]
    return pd.DataFrame(cols).astype(np.float32)


def _v3(w, cols) -> dict:
    hr_now = cols["hr_lag0"]
    out = {
        "run_hr_max": w["run_hr_max"], "run_hr_min": w["run_hr_min"], "run_hr_mean": w["run_hr_mean"],
        "hr_from_run_max": hr_now - w["run_hr_max"],
        "hr_from_run_min": hr_now - w["run_hr_min"],
        "hr_from_run_mean": hr_now - w["run_hr_mean"],
        "hr_from_run_start": hr_now - w["run_hr_first"],
        "run_pair_n": w["run_pair_n"], "run_hr_speed_slope": w["run_slope"],
    }
    # 지금까지의 HR-속도 직선으로 본 "이 속도면 HR이 여기쯤" 값과 지금 HR의 차이
    for name, speed in (("now", cols["speed_mean_6"]), ("fut12", cols["fut_speed_mean_12"]),
                        ("fut24", cols["fut_speed_mean_24"])):
        out[f"run_hr_gap_{name}"] = w["run_icpt"] + w["run_slope"] * speed - hr_now
    return out


def _v5(fs, cols) -> dict:
    out = {}
    with np.errstate(invalid="ignore"):
        slow = fs < SLOW_MPS                      # 결측 칸은 느린 칸으로 세지 않는다
    for k in WINDOWS:
        out[f"fut_speed_min_{k}"] = _nan(np.nanmin, fs[:, :k], axis=1)
        out[f"fut_slow_count_{k}"] = slow[:, :k].sum(axis=1)
    out["fut_first_slow"] = np.where(slow.any(axis=1), slow.argmax(axis=1) + 1, fs.shape[1] + 1)  # 없으면 25
    # HR은 바로 앞 속도에 가장 많이 반응한다: 30·60·120초 시점 직전 30초(6칸) 평균
    for k in WINDOWS[1:]:                         # 6칸은 fut_speed_mean_6과 같다
        end = _nan(np.nanmean, fs[:, k - 6:k], axis=1)
        out[f"fut_speed_end_{k}"] = end
        out[f"fut_speed_end_delta_{k}"] = end - cols["speed_mean_6"]
    return out


def _effort(speed, grade):
    """경사 보정 속도(m/s). 경사 결측은 평지로 본다(경사 신뢰도가 낮은 러닝이 많다)."""
    return speed * (1 + GRADE_COST * np.clip(np.nan_to_num(grade), -10, 15))


def _v6(w, hr, sp, gr, cols) -> dict:
    n = hr.shape[1]
    out = {}
    # A. 과거 노력 정점: 30초(6칸) 이동평균 노력의 최고점에서 지금까지 얼마나 내려왔고 얼마나 지났는지
    eff = _effort(sp, gr)
    roll = _nan(np.nanmean, np.lib.stride_tricks.sliding_window_view(eff, 6, axis=1), axis=2)  # (N, 19)
    empty = np.isnan(roll).all(axis=1)
    peak = np.where(empty, 0, np.nanargmax(np.where(np.isnan(roll), -np.inf, roll), axis=1))
    eff_now = roll[:, -1]
    out["eff_peak_drop_24"] = eff_now - _nan(np.nanmax, roll, axis=1)
    out["eff_since_peak"] = np.where(empty, np.nan, roll.shape[1] - 1 - peak)
    fut_eff = _effort(cols["fut_speed_mean_24"], cols["fut_grade_mean_24"])
    out["eff_fut_vs_past_24"] = fut_eff - _nan(np.nanmean, eff, axis=1)
    # B. 노력으로 설명 안 되는 HR 상승: HR 변화(중앙값 기준) − HR-속도 기울기 × 노력 변화
    slope = np.where(np.isnan(w["run_slope"]), w["prev_slope"], w["run_slope"])
    slope = np.clip(slope, 0, 50)
    now3 = _nan(np.nanmean, eff[:, -3:], axis=1)
    pw = past_windows(n)
    for k in pw:
        lo = min(k - 2, n - 3)  # v2 hr_med_diff_k와 같은 칸(lag lo..lo+2)
        d = now3 - _nan(np.nanmean, eff[:, n - 3 - lo:n - lo], axis=1)
        if k == pw[-1]:
            out[f"eff_diff_{k}"] = d  # 과거 전체 길이(기본 24칸)
        out[f"hr_excess_rise_{k}"] = cols[f"hr_med_diff_{k}"] - slope * d
    # C. 정제는 튄 칸만 결측으로 바꾸므로 결측을 건너 바로 앞 유효 값과 비교해야 끊김(수준 이동)이 보인다
    filled = pd.DataFrame(hr).ffill(axis=1).to_numpy()
    jumps = np.diff(filled, axis=1)
    with np.errstate(invalid="ignore"):
        big = np.abs(jumps) >= BIG_JUMP_BPM
    out["hr_jump_bridged_max"] = _nan(np.nanmax, np.abs(jumps), axis=1)
    out["hr_jump_bridged_count"] = big.sum(axis=1)
    last = np.where(big.any(axis=1), n - 2 - np.argmax(big[:, ::-1], axis=1), -1)
    out["hr_since_big_jump"] = np.where(last >= 0, n - 2 - last, n)          # 끊김 뒤 첫 칸부터 지금까지 칸 수, 없으면 24
    out["hr_big_jump_net"] = np.where(big, jumps, 0).sum(axis=1)             # 양수 = 끊김으로 올라와 있음
    return out


def _v4(w, cols) -> dict:
    hr_now = cols["hr_lag0"]
    out = {k: w[k] for k in ("prev_n_runs", "prev_days_since", "prev_hr_mean", "prev_hr_max", "prev_slope")}
    out["hr_from_prev_mean"] = hr_now - w["prev_hr_mean"]
    # 평소 워밍업 곡선: 지금 평소보다 얼마나 높은지, 평소라면 30·60·120초 동안 얼마나 오르는지
    out["prev_warm_gap"] = hr_now - w["prev_warm_hr_0"]
    for d in (30, 60, 120):
        out[f"prev_warm_rise_{d}"] = w[f"prev_warm_hr_{d}"] - w["prev_warm_hr_0"]
    out["prev_warm_speed_diff"] = cols["speed_mean_6"] - w["prev_warm_speed"]
    # 앞선 러닝의 HR-속도 직선으로 본 "이 속도면 HR이 여기쯤" 값과 지금 HR의 차이
    for name, speed in (("now", cols["speed_mean_6"]), ("fut12", cols["fut_speed_mean_12"]),
                        ("fut24", cols["fut_speed_mean_24"])):
        out[f"prev_hr_gap_{name}"] = w["prev_icpt"] + w["prev_slope"] * speed - hr_now
    return out


def _v2(w, hr, sp, gr, fs, fg) -> dict:
    n = hr.shape[1]
    cols = {"elapsed_s": w["elapsed_s"]}
    for name, arr in (("hr", hr), ("speed", sp), ("grade", gr)):
        cols[f"past_{name}_valid"] = (~np.isnan(arr)).sum(axis=1)
    cols["fut_speed_missing"] = np.isnan(fs).sum(axis=1)
    cols["fut_grade_missing"] = np.isnan(fg).sum(axis=1)

    # 한 칸이 튀어도 흔들리지 않도록 중앙값으로 지금 HR과 k칸 전 HR을 다시 잡는다.
    med = lambda lo, hi: _nan(np.nanmedian, hr[:, n - 1 - hi:n - lo], axis=1)  # lag lo..hi
    med3 = med(0, 2)
    cols["hr_med3"] = med3
    cols["hr_med5"] = med(0, 4)
    cols["hr_spike"] = hr[:, -1] - cols["hr_med5"]
    for k in past_windows(n):
        lo = min(k - 2, n - 3)  # hr_diff_k와 같은 lag k-1을 가운데에 둔다
        cols[f"hr_med_diff_{k}"] = med3 - med(lo, lo + 2)

    jumps = np.abs(np.diff(hr, axis=1))
    cols["hr_max_jump"] = _nan(np.nanmax, jumps, axis=1)
    with np.errstate(invalid="ignore"):
        cols["hr_jump_count"] = (jumps > JUMP_BPM).sum(axis=1)
    return cols
