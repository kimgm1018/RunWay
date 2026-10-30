"""HR Predictor 선발 테스트(T1~T6) 리허설: test 대신 v2 val로 같은 규칙을 미리 돌려 본다.

window 규칙 (테스트 시나리오 수정본과 같게)
 - t0는 세션 안에서 30초(6칸)마다, t0 이전 120초(t0 포함 24칸)와 이후 120초(24칸)가 같은 구간에 끊김 없이 있어야 한다
 - 과거 24칸의 심박·속도·경사, 미래 24칸의 속도·경사에 빈 값이 없어야 한다
 - HR0와 정답 HR@30/60/120이 하나라도 보간값(hr_is_filled)이면 뺀다
 - 모델에는 현재 러닝 시작부터 t0까지의 원본(빈 값·구간 번호 포함)을 넘긴다. 무엇을 쓸지는 predictor가 정한다
 - personalized val의 query 러닝 → T1~T4, cold start val → T5. test는 쓰지 않는다
개인화: 사람마다 personalize(support) → predict (ON), reset → predict (OFF). Query로는 개인화하지 않는다.
S_flat·S_hold(시험에는 없음): 미래 속도를 평평한 계획(실제 2분 평균 / 지금 pace)으로 넣었을 때의 MAE. 서비스 확인용.

실행: python ai/gru/rehearsal.py --checkpoint ~/runway-runs/M3-005/best.pt --nograde-checkpoint ~/runway-runs/M3-006/best.pt
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from data import FUT, session_roles_v2
from eval_personal import person_of
from predictor import load

PAST = 24             # 과거 120초
T0_STEP = 6           # t0 간격 30초
H = [6, 12, 24]       # +30, +60, +120초
PACE_DELTAS = [-10, -5, 0, 5, 10]   # sec/km, 빠른 순
GRADE_DELTAS = [-2, 0, 2]           # %p
COLS = ["subject_id", "session_id", "segment_id", "elapsed_s", "hr_bpm", "speed_mps", "grade_observed_pct",
        "hr_is_filled", "hr_quality"]


def load_raw(data_dir, n_files, subjects):
    """빈 값을 빼지 않은 원본 시계열 (품질 괜찮은 세션, 지정한 사람만)."""
    data_dir = Path(data_dir)
    sessions = pd.read_parquet(data_dir / "sessions.parquet", columns=["session_id", "workout_quality_v1"])
    good = set(sessions.loc[sessions["workout_quality_v1"] != "LOW_QUALITY", "session_id"])
    files = sorted((data_dir / "timeseries").glob("*.parquet"))[:n_files]
    parts = []
    for f in files:
        d = pd.read_parquet(f, columns=COLS)
        parts.append(d[d["session_id"].isin(good) & d["subject_id"].isin(subjects)])
    return pd.concat(parts, ignore_index=True)


def make_windows(df, roles, group_of):
    """시나리오 규칙대로 공통 window 목록(현재 러닝 시작~t0 원본 + 미래 24칸)과 정답·메타 정보를 만든다."""
    windows, meta = [], []
    for sid, s in df.groupby("session_id", sort=True):
        if roles.get(sid) != "val":
            continue
        s = s.sort_values("elapsed_s")
        hr, sp, gr, el = (s[c].to_numpy(np.float32) for c in ["hr_bpm", "speed_mps", "grade_observed_pct", "elapsed_s"])
        seg = s["segment_id"].to_numpy()
        measured = ~s["hr_is_filled"].to_numpy(bool) & ~np.isnan(hr)
        for now in range(PAST - 1, len(s) - FUT, T0_STEP):
            lo, hi = now - PAST + 1, now + FUT
            if el[hi] - el[lo] != 5.0 * (hi - lo) or (seg[lo:hi + 1] != seg[now]).any():   # 끊김·구간 경계
                continue
            if np.isnan(np.r_[hr[lo:now + 1], sp[lo:hi + 1], gr[lo:hi + 1]]).any():
                continue
            if not (measured[now] and measured[[now + h for h in H]].all()):
                continue
            windows.append({"hr": hr[:now + 1], "speed": sp[:now + 1], "grade": gr[:now + 1], "elapsed_s": el[:now + 1],
                            "segment_id": seg[:now + 1], "future_speed": sp[now + 1:now + 1 + FUT],
                            "future_grade": gr[now + 1:now + 1 + FUT]})
            meta.append({"session": sid, "group": group_of[s["subject_id"].iloc[0]], "hr0": hr[now],
                         "true": hr[[now + h for h in H]], "v_past30": sp[now - 5:now + 1].mean(),
                         "v_future60": sp[now + 1:now + 13].mean()})
    return windows, meta


def run(predictor, windows, chunk=4096):
    return np.concatenate([predictor.predict(windows[i:i + chunk]) for i in range(0, len(windows), chunk)])


def run_personal(predictor, states, windows, groups):
    """window마다 그 사람의 개인화 상태로 예측한다 (상태가 없으면 기본 = OFF)."""
    out = np.zeros((len(windows), 3), np.float32)
    for g in np.unique(groups):
        pos = np.flatnonzero(groups == g)
        predictor.load_state(states.get(g))
        out[pos] = run(predictor, [windows[i] for i in pos])
    predictor.reset()
    return out


def mae_row(pred, true, mask=None):
    err = np.abs(pred - true) if mask is None else np.abs(pred - true)[mask]
    m = err.mean(0)
    return {"MAE30": float(m[0]), "MAE60": float(m[1]), "MAE120": float(m[2]), "Mean": float(m.mean()), "windows": int(len(err))}


def pace_plan(v_now, v_cand):
    """0~20초 현재 pace, 20~40초 선형 변화, 40~120초 candidate (24칸, 칸 끝 시각 5~120초)."""
    t = 5.0 * np.arange(1, FUT + 1)
    frac = np.clip((t - 20) / 20, 0, 1)
    return (v_now + (v_cand - v_now) * frac).astype(np.float32)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", default="~/runway-runs/M3-005/best.pt")
    p.add_argument("--nograde-checkpoint", default=None)         # 경사 모를 때 쓰는 모델 (없으면 0% 평지로 채움)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")   # T1~T5 계산용 (T6는 CPU)
    p.add_argument("--n-files", type=int, default=None)          # 동작 확인용: 시계열 파일 수
    p.add_argument("--out", default=None)                        # 결과 json 경로
    args = p.parse_args()

    predictor = load(args.checkpoint, args.device, args.nograde_checkpoint)
    a = torch.load(Path(args.checkpoint).expanduser(), map_location="cpu", weights_only=False)["args"]
    with open(a["split_path"], encoding="utf-8") as f:
        spec = json.load(f)
    assert "cohorts" in spec, "v2 분할 모델만"
    groups = person_of(a["split_path"])
    group_of = lambda s: groups.get(s, s)
    roles = session_roles_v2(spec, a["data_dir"])
    personal, cold = set(spec["cohorts"]["personalized_val"]), set(spec["cohorts"]["cold_start_val"])
    members = {s for g in personal | cold for s in spec["group_members"].get(g, [g])}
    df = load_raw(a["data_dir"], args.n_files or a["n_files"], members)
    df = df.assign(group=df["subject_id"].map(group_of), role=df["session_id"].map(roles))
    windows, meta = make_windows(df, roles, {s: group_of(s) for s in df["subject_id"].unique()})
    meta = pd.DataFrame(meta)
    true, hr0 = np.stack(meta["true"]), meta["hr0"].to_numpy(np.float32)
    is_cold = meta["group"].isin(cold).to_numpy()
    G = meta["group"].to_numpy()
    res = {}

    def counts(mask):
        return {"groups": int(meta.loc[mask, "group"].nunique()), "sessions": int(meta.loc[mask, "session"].nunique()),
                "windows": int(mask.sum())}

    # 개인화: personalized 사람마다 personalize(support). Query는 쓰지 않는다
    t = time.time()
    states = {}
    for g in meta.loc[~is_cold, "group"].unique():
        states[g] = predictor.personalize(df[(df["group"] == g) & (df["role"] == "support")])
        predictor.reset()
    res["personalize_seconds"] = time.time() - t

    # T1: 실제 future speed·grade, 개인화 ON과 OFF (OFF = reset 상태)
    P = ~is_cold
    off = run(predictor, windows)
    pred = run_personal(predictor, states, windows, G)                   # cold start는 상태 없음 = 기본
    persist = np.repeat(hr0[:, None], 3, 1)
    on_mean, off_mean = mae_row(pred[P], true[P])["Mean"], mae_row(off[P], true[P])["Mean"]
    res["T1"] = {**mae_row(pred[P], true[P]), **counts(P), "persistence_mean": mae_row(persist[P], true[P])["Mean"],
                 "off_mean": off_mean, "gain_personalization": off_mean - on_mean}
    user = pd.Series(np.abs(pred - true).mean(1)[P]).groupby(G[P]).mean()
    res["T1"]["user_p90"] = float(np.percentile(user, 90))

    # 시험에는 없는 서비스 확인용: MPC처럼 평평한 속도 계획을 넣었을 때의 정확도 (T1 window, 개인화 ON)
    idx = np.flatnonzero(P)
    for name, speed in [("S_flat", lambda i: np.full(FUT, windows[i]["future_speed"].mean(), np.float32)),   # 실제 2분 평균
                        ("S_hold", lambda i: np.full(FUT, meta.at[i, "v_past30"], np.float32))]:          # 지금 pace 유지
        ps = run_personal(predictor, states, [{**windows[i], "future_speed": speed(i)} for i in idx], G[idx])
        res[name] = mae_row(ps, true[idx])

    # T2: 실제 속도 변화로 가속·감속 window 고르기 (T1 ON 예측 재사용)
    dv = (meta["v_future60"] - meta["v_past30"]).to_numpy()
    for name, m in [("accel", P & (dv >= 0.15)), ("decel", P & (dv <= -0.15))]:
        r = mae_row(pred[m], true[m])
        chg_true, chg_pred = true[m, 2] - hr0[m], pred[m, 2] - hr0[m]
        keep = np.abs(chg_true) >= 2
        r["direction_acc120"] = float((np.sign(chg_true[keep]) == np.sign(chg_pred[keep])).mean()) if keep.any() else None
        res[f"T2_{name}"] = r

    # T3-A: candidate pace 5개 (현재 속도 1.5 m/s 미만 제외), 경사는 실제
    idx = np.flatnonzero(P & (meta["v_past30"].to_numpy() >= 1.5))
    preds = []
    for d in PACE_DELTAS:
        ws = []
        for i in idx:
            v_now = float(meta.at[i, "v_past30"])
            ws.append({**windows[i], "future_speed": pace_plan(v_now, 1000 / (1000 / v_now + d))})
        preds.append(run_personal(predictor, states, ws, G[idx]))
    preds = np.stack(preds)                                              # (5 후보, window, 3), 빠른 순
    rev = {f"speed_reversal@{s}": float((preds[:-1, :, h] < preds[1:, :, h] - 0.5).mean()) for s, h in [(60, 1), (120, 2)]}
    span = preds[0, :, 2] - preds[-1, :, 2]                              # 가장 빠른 - 가장 느린 (20 sec/km 차이)
    res["T3A"] = {**rev, "sensitivity_bpm_per_10s_km": float(np.median(span / 2)),
                  "no_response_rate": float((np.abs(span) < 0.5).mean()), "windows": int(len(idx))}

    # T3-B: 속도는 현재 pace 유지, 경사 -2/0/+2%p (±30% clip은 predictor가 함)
    idx = np.flatnonzero(P)
    preds = []
    for d in GRADE_DELTAS:
        ws = [{**windows[i], "future_speed": np.full(FUT, meta.at[i, "v_past30"], np.float32),
               "future_grade": windows[i]["future_grade"] + d} for i in idx]
        preds.append(run_personal(predictor, states, ws, G[idx]))
    preds = np.stack(preds)                                              # 낮은 경사 → 높은 경사
    res["T3B"] = {f"grade_reversal@{s}": float((preds[1:, :, h] < preds[:-1, :, h] - 1.0).mean()) for s, h in [(60, 1), (120, 2)]}
    res["T3B"]["windows"] = int(len(idx))

    # T4: 미래 grade를 주지 않음 (predictor의 missing 정책 = 평지)
    pred4 = run_personal(predictor, states, [{**windows[i], "future_grade": None} for i in idx], G[idx])
    res["T4"] = {**mae_row(pred4, true[P]), "worse_than_T1": mae_row(pred4, true[P])["Mean"] - on_mean}
    # T4 정책 후보 B: 미래 경사를 t0 직전 30초·60초 평균 경사로 채움 (t0까지 관측값만 사용)
    for name, n in [("T4_hold30", 6), ("T4_hold60", 12)]:
        ws = [{**windows[i], "future_grade": np.full(FUT, np.nanmean(windows[i]["grade"][-n:]), np.float32)} for i in idx]
        pb = run_personal(predictor, states, ws, G[idx])
        res[name] = {**mae_row(pb, true[P]), "worse_than_T1": mae_row(pb, true[P])["Mean"] - on_mean}

    # T5: cold start, 개인화 없이 기본 상태
    C = is_cold
    res["T5"] = {**mae_row(off[C], true[C]), **counts(C), "persistence_mean": mae_row(persist[C], true[C])["Mean"]}

    # T6: CPU, 요청 1건 = 현재 러닝 처리 + candidate 5개 예측, warm-up 20회 뒤 window 200개 (개인화 상태 사용)
    cpu = load(args.checkpoint, "cpu", args.nograde_checkpoint)
    pick = np.random.default_rng(42).choice(idx, 220, replace=len(idx) < 220)
    g0 = G[pick[0]]
    cpu.load_state(states.get(g0))                                       # load_state가 CPU로 옮겨 끼운다
    times = []
    for j, i in enumerate(pick):
        v_now = max(float(meta.at[i, "v_past30"]), 0.5)
        req = [{**windows[i], "future_speed": pace_plan(v_now, 1000 / (1000 / v_now + d))} for d in PACE_DELTAS]
        t = time.perf_counter(); cpu.predict(req); dt = time.perf_counter() - t
        if j >= 20:
            times.append(dt)
    res["T6"] = {"p95_s": float(np.percentile(times, 95)), "p50_s": float(np.percentile(times, 50)),
                 "pass": bool(np.percentile(times, 95) <= 1.0)}

    print(json.dumps(res, ensure_ascii=False, indent=1))
    if args.out:
        Path(args.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
