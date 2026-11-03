"""(세션, t0) 표본과 입력 dropout (CONTRACT 4.1·4.2절). t0 = 5·r0초(5초 격자)."""
from __future__ import annotations

import numpy as np

P_ZERO = 0.3                    # t0 = 0 확률
MIN_R0 = 1                      # 5초
TAIL_ROWS = 24                  # E − 2분
P_DROP = 0.2
DROP_NAMES = ('p4', 'history', 'summary', 'today')


def anchor_candidates(prep: dict) -> np.ndarray:
    """[5초, E − 2분] 5초 행 중 HR(t0) = hr5[r0]가 실측인 r0."""
    n = int(prep['n_cell'])
    rs = np.arange(MIN_R0, 6 * n - TAIL_ROWS + 1)
    if not len(rs):
        return rs
    return rs[np.isfinite(np.asarray(prep['hr5'])[rs])]


def choose_r0(prep: dict, rng: np.random.Generator) -> int:
    u = rng.random()
    cands = anchor_candidates(prep)
    if u < P_ZERO or not len(cands):
        return 0
    return int(rng.choice(cands))


def epoch_plan(records, seed: int, epoch: int, p_drop: float = P_DROP) -> dict:
    """epoch마다 세션당 r0 하나와 입력 dropout 4개(서로 독립). (seed, epoch)로 고정."""
    rng = np.random.default_rng([seed, epoch])
    r0 = np.array([choose_r0(r.prep, rng) for r in records], np.int64)
    drop = np.random.default_rng([seed, epoch, 1]).random((len(records), len(DROP_NAMES))) < p_drop
    return dict(r0=r0, drop=drop)
