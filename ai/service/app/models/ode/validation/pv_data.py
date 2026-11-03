"""Pre-run Validation v1 데이터 규칙 (CONTRACT.md 3·4절, Amendment 1 A4).

세션 하나(canonical 5초 행, (segment, elapsed) 정렬)를 0초 출발 rollout 입력과 30초 채점 점으로 정리한다.
유효 값 = 유한 + quality ∈ {GOOD, LOW}. 채점 정답 = 유효 HR이면서 hr_is_filled == False.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

QUALITY_ALLOWED = ('GOOD', 'LOW')
GRID_S = 5
CELL_ROWS = 6                  # 30초 cell
MAX_FIRST_ACTION_ROW = 12      # 첫 유효 action은 60초 안
MAX_ACTION_GAP = 6             # 30초 이하 action 결측은 LOCF
MIN_CELLS = 4                  # 2분
TS_COLUMNS = ['session_id', 'segment_id', 'elapsed_s', 'hr_bpm', 'speed_mps', 'grade_observed_pct',
              'hr_quality', 'speed_quality', 'grade_quality', 'hr_is_filled']


def valid_masks(df: pd.DataFrame):
    def ok(value_col, quality_col):
        v = df[value_col].to_numpy(np.float64)
        return np.isfinite(v) & df[quality_col].isin(QUALITY_ALLOWED).to_numpy()
    return ok('hr_bpm', 'hr_quality'), ok('speed_mps', 'speed_quality'), ok('grade_observed_pct', 'grade_quality')


def prepare_session(df: pd.DataFrame):
    """정리된 dict, 또는 제외 사유 문자열('no_start_hr' / 'late_or_no_action' / 'span_lt_2min')."""
    seg = df.segment_id.to_numpy()
    el = df.elapsed_s.to_numpy(np.float64)
    n = len(df)
    length = 1                                          # 첫 segment, 5초 연속인 앞부분 길이
    while length < n and seg[length] == seg[0] and el[length] - el[length - 1] == GRID_S:
        length += 1
    hr_ok, sp_ok, gr_ok = valid_masks(df)
    filled = df.hr_is_filled.astype(object).fillna(True).to_numpy(bool)
    measured = hr_ok & ~filled
    if not measured[0]:
        return 'no_start_hr'
    act = (sp_ok & gr_ok)[:length]
    if not act.any() or int(np.argmax(act)) > MAX_FIRST_ACTION_ROW:
        return 'late_or_no_action'
    fa = int(np.argmax(act))
    last_ok, gap = fa, 0
    for i in range(fa + 1, length):
        if act[i]:
            last_ok, gap = i, 0
        else:
            gap += 1
            if gap > MAX_ACTION_GAP:
                break
    end = last_ok
    n_cell = end // CELL_ROWS
    if n_cell < MIN_CELLS:
        return 'span_lt_2min'
    speed = df.speed_mps.to_numpy(np.float64)
    grade = df.grade_observed_pct.to_numpy(np.float64)
    rows = np.arange(1, CELL_ROWS * n_cell + 1)
    src = np.where(act[:end + 1], np.arange(end + 1), -1)
    src = np.maximum.accumulate(src)                    # LOCF: 그 행까지의 마지막 유효 action 행
    src[:fa] = fa                                       # fa 앞은 fa로 backfill
    use = src[rows]
    speed_rows, grade_rows = speed[use], grade[use]
    cell_speed = speed_rows.reshape(n_cell, CELL_ROWS).mean(axis=1)
    cell_grade = grade_rows.reshape(n_cell, CELL_ROWS).mean(axis=1)
    k_rows = CELL_ROWS * np.arange(1, n_cell + 1)
    ks = np.arange(1, n_cell + 1)
    return dict(hr0=float(df.hr_bpm.iloc[0]), fa=fa, E=int(end), n_cell=int(n_cell),
                speed_rows=speed_rows, grade_rows=grade_rows, cell_speed=cell_speed, cell_grade=cell_grade,
                cum_speed=np.cumsum(cell_speed) / ks, cum_grade=np.cumsum(cell_grade) / ks,
                actual=df.hr_bpm.to_numpy(np.float64)[k_rows], scored=measured[k_rows])
