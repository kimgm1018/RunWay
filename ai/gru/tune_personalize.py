"""개인화 강도(L2) 고르기: val personalized 사람들의 T1 window에서 L2별 개인화 ON MAE를 비교한다 (test는 쓰지 않음).

window·support는 rehearsal.py와 같다. GRU 특징은 한 번만 계산하고 출력층만 L2별로 다시 맞춘다.

실행: python tune_personalize.py --checkpoint ~/runway-runs/M3-005/best.pt --l2 0 0.01 0.03 0.1 0.3
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from data import session_roles_v2
from eval_personal import person_of
from predictor import load
from rehearsal import load_raw, make_windows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", default="~/runway-runs/M3-005/best.pt")
    p.add_argument("--l2", type=float, nargs="+", default=[0.0, 0.01, 0.03, 0.1, 0.3])
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    predictor = load(args.checkpoint, args.device, nograde_checkpoint=None)
    a = torch.load(Path(args.checkpoint).expanduser(), map_location="cpu", weights_only=False)["args"]
    with open(a["split_path"], encoding="utf-8") as f:
        spec = json.load(f)
    groups = person_of(a["split_path"])
    group_of = lambda s: groups.get(s, s)
    roles = session_roles_v2(spec, a["data_dir"])
    personal = set(spec["cohorts"]["personalized_val"])
    members = {s for g in personal for s in spec["group_members"].get(g, [g])}
    df = load_raw(a["data_dir"], a["n_files"], members)
    df = df.assign(group=df["subject_id"].map(group_of), role=df["session_id"].map(roles))
    windows, meta = make_windows(df, roles, {s: group_of(s) for s in df["subject_id"].unique()})
    meta = pd.DataFrame(meta)
    true, hr0, G = np.stack(meta["true"]), meta["hr0"].to_numpy(np.float32), meta["group"].to_numpy()

    # query window의 GRU 마지막 상태 (출력층 입력)는 한 번만 계산
    x = np.stack([predictor.make_input(w) for w in windows])
    with torch.no_grad():
        qf = torch.cat([predictor.model.features(torch.from_numpy(x[i:i + 4096]).to(args.device))
                        for i in range(0, len(x), 4096)])
    std = float(predictor.std[2])

    def pred_with(state, idx):
        w, b = state
        with torch.no_grad():
            return hr0[idx, None] + (qf[idx] @ w.T + b).cpu().numpy() * std

    sup = {g: predictor.support_features(df[(df["group"] == g) & (df["role"] == "support")]) for g in np.unique(G)}
    off = pred_with(predictor.base_head, np.arange(len(windows)))
    user_off = pd.Series(np.abs(off - true).mean(1)).groupby(G).mean()
    rows = [{"l2": "OFF", "Mean": float(np.abs(off - true).mean()), "user_p90": float(np.percentile(user_off, 90))}]
    for l2 in args.l2:
        on = off.copy()
        for g in np.unique(G):
            idx = np.flatnonzero(G == g)
            on[idx] = pred_with(predictor.fit_head(predictor.base_head, sup[g], args.steps, args.lr, l2), idx)
        predictor.reset()
        err = np.abs(on - true)
        user = pd.Series(err.mean(1)).groupby(G).mean()
        rows.append({"l2": l2, "Mean": float(err.mean()), "MAE30/60/120": [round(float(v), 3) for v in err.mean(0)],
                     "gain": float(np.abs(off - true).mean() - err.mean()), "users_better": int((user < user_off).sum()),
                     "users_worse": int((user > user_off).sum()), "user_p90": float(np.percentile(user, 90))})
    print(f"window {len(windows)}, 사람 {len(np.unique(G))}")
    for r in rows:
        print(json.dumps(r, ensure_ascii=False))
    if args.out:
        Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
