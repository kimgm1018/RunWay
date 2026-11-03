"""(세션, t0) 표본 묶음 → 모델 입력 tensor (CONTRACT 3.4·4.3절).

t0 = 5·r0초. 미래 30초 cell j = 행 (r0 + 6(j−1), r0 + 6j]의 sp5·gr5 평균(마지막 cell은 E까지 남은 행).
rollout 10초 step 수 L = ⌊(6·n_cell − r0)/2⌋, 정답 y_i = hr5[r0 + 2i] (i = 1 … L).
짧은 표본은 마지막 action을 반복하고 손실에서 가린다(weight 0, mask False).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch

from . import cells, today
from . import summary as S
from .history import HISTORY_DIM, SENTINEL

W_2MIN, W_5MIN = 4.0, 2.0       # (0,120]초, (120,300]초. 그 밖 1
T0_ZERO_BOOST = 2.0             # t0 = 0 표본의 (0,300]초 추가 배수


@dataclass
class Item:
    rec: object                 # data.Record (prep, y10)
    r0: int                     # t0 = 5·r0초
    ctx: object                 # context.Context
    group_index: int            # Train ID 표 번호, 없으면 −1
    drop: np.ndarray            # bool[4] = (p4, history, summary, today)
    p4: np.ndarray | None = None


def future_cells(prep: dict, r0: int) -> tuple:
    """t0에서 시작하는 30초 cell의 (평균 속도, 평균 경사).

    r0 = 6k이면 harness cell_speed[k:]·cell_grade[k:]를 그대로 쓴다. 실제 데이터에서 5초 행 평균과 bit 단위로 같다
    (계약 0절, 14,985건). 출발 전 adapter처럼 cell 값만 있는 경우도 이 경로를 탄다.
    """
    if int(r0) % 6 == 0 and 'cell_speed' in prep:
        k = int(r0) // 6
        return np.asarray(prep['cell_speed'], np.float64)[k:], np.asarray(prep['cell_grade'], np.float64)[k:]
    end = 6 * int(prep['n_cell'])
    out = []
    for key in ('sp5', 'gr5'):
        rows = np.asarray(prep[key], np.float64)[int(r0) + 1:end + 1]
        full = len(rows) // 6
        v = rows[:6 * full].reshape(full, 6).mean(axis=1)
        if len(rows) > 6 * full:
            v = np.concatenate([v, [rows[6 * full:].mean()]])
        out.append(v)
    return out[0], out[1]


def n_steps(prep: dict, r0: int) -> int:
    return (6 * int(prep['n_cell']) - int(r0)) // 2


def loss_weights(n: int, r0: int) -> np.ndarray:
    tau = 10.0 * np.arange(1, n + 1)
    w = np.where(tau <= 120.0, W_2MIN, np.where(tau <= 300.0, W_5MIN, 1.0))
    if int(r0) == 0:
        w = np.where(tau <= 300.0, w * T0_ZERO_BOOST, w)
    return w.astype(np.float32)


def collate(items, stats: dict, max_steps: int | None = None) -> dict:
    size = len(items)
    steps = [n_steps(it.rec.prep, it.r0) for it in items]
    if max_steps is not None:
        steps = [min(s, int(max_steps)) for s in steps]
    width = max(steps)
    activity = np.zeros((size, width, 2), np.float32)
    time = np.zeros((size, width), np.float32)
    y = np.full((size, width), np.nan, np.float32)
    weight = np.zeros((size, width), np.float32)
    hr_t0 = np.zeros(size, np.float32)
    win = np.zeros((size, today.WINDOW, 4), np.float32)
    tsum = np.zeros((size, today.N_SUMMARY), np.float32)
    u_vals = np.zeros((size, S.N_FEATURES), np.float32)
    u_mask = np.zeros((size, S.N_FEATURES), bool)
    hists = []
    for i, it in enumerate(items):
        p, r0, d, L = it.rec.prep, int(it.r0), np.asarray(it.drop, bool), steps[i]
        sp, gr = future_cells(p, r0)
        a10 = cells.expand10(cells.activity_from_cells(sp, gr))[:L]
        activity[i, :L] = a10
        activity[i, L:] = a10[-1]
        time[i] = ((5.0 * r0 + 10.0 * np.arange(width)) / cells.TIME_SCALE_S).astype(np.float32)
        hr5 = np.asarray(p['hr5'], np.float64)
        y[i, :L] = hr5[r0 + 2:r0 + 2 * L + 1:2]
        weight[i, :L] = loss_weights(L, r0)
        hr_t0[i] = hr5[r0]
        if d[3] and r0 > 0:
            win[i], tsum[i] = today.empty()
        else:
            win[i], tsum[i] = today.window(p, r0), today.run_summary(p, r0)
        hists.append(SENTINEL if d[1] else it.ctx.history)
        u_vals[i], u_mask[i] = S.empty() if d[2] else S.normalize(it.ctx.u_raw, stats)
    hw = max(len(h) for h in hists)
    hist = np.zeros((size, hw, HISTORY_DIM), np.float32)
    for i, h in enumerate(hists):
        hist[i, :len(h)] = h
    mask = np.isfinite(y)
    out = dict(hr_t0=torch.from_numpy(hr_t0), activity=torch.from_numpy(activity), time=torch.from_numpy(time),
               y=torch.from_numpy(np.nan_to_num(y)), mask=torch.from_numpy(mask),
               weight=torch.from_numpy(np.where(mask, weight, 0.0).astype(np.float32)),
               history=torch.from_numpy(hist), history_length=torch.tensor([len(h) for h in hists]),
               u_vals=torch.from_numpy(u_vals), u_mask=torch.from_numpy(u_mask),
               today_window=torch.from_numpy(win), today_summary=torch.from_numpy(tsum),
               group_index=torch.tensor([int(it.group_index) for it in items], dtype=torch.long),
               p4_keep=torch.tensor([not bool(it.drop[0]) for it in items]),
               n_steps=torch.tensor(steps), r0=torch.tensor([int(it.r0) for it in items]))
    if any(it.p4 is not None for it in items):
        if not all(it.p4 is not None for it in items):
            raise ValueError('p4는 batch 안 모든 표본에 주거나 아무 표본에도 주지 않는다')
        out['p4'] = torch.from_numpy(np.stack([np.asarray(it.p4, np.float32) for it in items]))
    return out
