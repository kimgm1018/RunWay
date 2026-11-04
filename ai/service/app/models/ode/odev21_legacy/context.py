"""개인 입력 구성 (CONTRACT 3.2·3.3절): History8 입력, 요약 묶음 u 원값, hr_ref.

대상 세션보다 앞선 출처 세션만 쓴다(history: 시작·끝 < 대상 시작, 요약: 끝 ≤ 대상 시작, 최근 5개).
학습은 출처 = Train, 평가는 출처 = support.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import summary as S
from .history import PastSession, build_history


@dataclass
class Context:
    history: np.ndarray
    u_raw: dict
    hr_ref: float


class SourceIndex:
    def __init__(self, sources) -> None:
        self.past, self.prior = {}, {}
        for r in sources:
            self.past.setdefault(r.group, []).append(PastSession(r.start, r.end_hist, r.hist_rows, r.session_id))
            self.prior.setdefault(r.group, []).append(S.PriorRun(end=r.end_s, usable=r.usable, summary=r.summ))


def build_context(target, index: SourceIndex) -> Context:
    hist = build_history(index.past.get(target.group, []), target.start)
    picked, gap = S.select_prior(index.prior.get(target.group, []), target.start_s)
    raw = S.aggregate([p.summary for p in picked], gap)
    return Context(history=hist, u_raw=raw, hr_ref=float(raw['hr_ref']))


def contexts_for(targets, sources) -> dict:
    index = SourceIndex(sources)
    return {t.session_id: build_context(t, index) for t in targets}
