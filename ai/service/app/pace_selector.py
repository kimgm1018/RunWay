"""AI04 개인 코칭과 AI10 그룹 페이스가 함께 쓰는 페이스 선택 규칙(S15P31E105-624).

후보는 지금 안내 G + DELTAS(초/km)다. 후보마다 "GRU 예측 + 여유 < 허용 심박"이면 통과한다.
- 지금 안내가 통과하지 못하면 통과하는 가장 빠른 느린 후보, 없으면 가장 느린 후보(FLOOR).
- 지금 안내가 통과하면 상한(목표 페이스, 없으면 시작 추천) 안에서 30초/km까지 빠른 후보 중 허용 − 3 bpm도
  통과하는 가장 빠른 후보로 올린다(RECOVERED). 상한이 없으면 올리지 않는다.
- 마지막 변경 뒤 120초는 바꾸지 않는다(COOLDOWN). 단 위험 심박에서 늦추는 것은 허용한다.
  AI10은 직전 변경이 가속(FAST)이면 쿨다운 중에도 늦춘다(slow_after_fast, S15P31E105-751).
- AI10은 FLOOR를 위험 심박이 아니면 한 번에 FLOOR_STEP까지만 늦춘다(floor_step_sec_per_km, S15P31E105-751).
- 출발 뒤 180초 동안은 +10초/km까지만 늦춘다(WARMUP_CAP). 10초/km 미만 변화는 유지(SMALL_CHANGE)다.

이 모듈은 numpy와 모델 상수만 쓴다. app.decide.schemas가 DELTAS를 가져가므로 app.policy를 import하지 않는다.
"""
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from app.models.base import HORIZONS_SEC

DELTAS = (-30, -20, -10, 0, 10, 20, 30, 45, 60)
MIN_CHANGE_SEC_PER_KM = 10
COOLDOWN_SEC = 120
WARMUP_SEC = 180
WARMUP_SLOW_CAP_SEC_PER_KM = 10
RECOVER_BAND_BPM = 3.0
FLOOR_STEP_SEC_PER_KM = 30
MAX_RECOVER_SEC_PER_KM = 30
# 요청 페이스는 소수 둘째 자리까지 오므로(AI04 후보 검증 허용 0.01) 부동소수 오차를 이 안에서 같은 값으로 본다.
PACE_EPS = 0.01


def candidate_paces(current: float, deltas: Sequence[float] = DELTAS) -> list[float]:
    """지금 안내 G + deltas 중 양수인 페이스(느린 쪽으로 오름차순)."""
    return [current + delta for delta in deltas if current + delta > 0]


def upper_bound(prediction: Sequence[float], pace: float, current: float, measured_speed: float | None,
                mean_grade: float | None, cfg, margins) -> float:
    """후보 하나의 상한 심박.

    늦추는 후보는 120초 예측 + AI04 감속 여유 표(cfg.hr_slow_margin_120_bpm, 경사 칸별)를 쓴다. 30/60초 예측은
    늦춰도 거의 그대로라 세 지평선 최대로는 감속 폭을 가를 수 없다. 유지·빠른 후보는 세 지평선마다
    예측 + 잔차 여유 표(실측 속도 대비 방향, 경사)의 최대를 쓴다.
    """
    if pace > current:
        return prediction[2] + cfg.hr_slow_margin_120_bpm[margins.grade_of(mean_grade) or "UNKNOWN"]
    dspeed = 1000.0 / pace - measured_speed if measured_speed is not None else None
    return max(value + margins.margin(horizon, dspeed, mean_grade)
               for value, horizon in zip(prediction, HORIZONS_SEC))


@dataclass(frozen=True)
class Selection:
    index: int
    reason: str      # HR_LIMIT / RECOVERED / COOLDOWN / WARMUP_CAP / FLOOR / SMALL_CHANGE
    cap_missing: bool


class PaceSelector:
    """후보 페이스·상한·허용선으로 한 번의 선택을 한다. uppers는 (사람 수, 후보 수), allows는 (사람 수,)."""

    def __init__(self, paces: Sequence[float], current: float, uppers, allows,
                 blocked: Callable[[int], bool] | None = None):
        self.paces = list(paces)
        self.current = current
        self.baseline = self.index_of(current)
        self.uppers = np.asarray(uppers, dtype=float).reshape(-1, len(self.paces))
        self.allows = np.asarray(allows, dtype=float).reshape(-1)
        self.blocked = blocked

    def index_of(self, pace: float) -> int:
        for index, value in enumerate(self.paces):
            if abs(value - pace) <= PACE_EPS:
                return index
        raise ValueError(f"후보에 {pace} 페이스가 없습니다")

    def passes(self, index: int, *, recover: bool = False) -> bool:
        if self.blocked is not None and self.blocked(index):
            return False
        return bool(np.all(self.uppers[:, index] < self.allows - (RECOVER_BAND_BPM if recover else 0.0)))

    def select(self, *, danger: bool, cap: float | None, elapsed_sec: float,
               since_change_sec: float | None, slow_base: float | None = None,
               warmup_exempt: bool = False, slow_after_fast: bool = False,
               floor_step_sec_per_km: float | None = None) -> Selection:
        """slow_base: 워밍업 감속 상한의 기준(기본 = current). warmup_exempt: 위험이면 워밍업 상한을 걸지 않는다.
        두 인자는 AI04만 쓴다(S15P31E105-624 수정 1·2). AI10은 기본값이라 동작이 그대로다.
        slow_after_fast: 직전 변경이 가속이면 쿨다운 중에도 감속을 허용한다. floor_step_sec_per_km: 위험 심박이
        아닐 때 FLOOR 감속 폭 상한. 두 인자는 AI10만 쓴다(S15P31E105-751). AI04는 기본값이라 동작이 그대로다."""
        paces, current, baseline = self.paces, self.current, self.baseline
        chosen, reason, cap_missing = baseline, "SMALL_CHANGE", False
        if not self.passes(baseline):
            slower = [j for j, pace in enumerate(paces) if pace > current]
            chosen = next((j for j in slower if self.passes(j)), slower[-1])
            reason = "HR_LIMIT" if self.passes(chosen) else "FLOOR"
            if reason == "FLOOR" and floor_step_sec_per_km is not None and not danger:
                # 통과 후보가 없어도 위험 심박이 아니면 한 번에 크게 늦추지 않고 다음 판단에서 더 늦춘다.
                within = [j for j in slower if paces[j] <= current + floor_step_sec_per_km + PACE_EPS]
                if within:
                    chosen = within[-1]
        else:
            if cap is None:
                cap_missing = True
            else:
                chosen = next((j for j, pace in enumerate(paces)
                               if current - MAX_RECOVER_SEC_PER_KM - PACE_EPS <= pace < current - PACE_EPS
                               and pace >= cap - PACE_EPS
                               and self.passes(j, recover=True)), baseline)
            if chosen != baseline:
                reason = "RECOVERED"

        if since_change_sec is not None and since_change_sec < COOLDOWN_SEC:
            if not (paces[chosen] > current + PACE_EPS and (danger or slow_after_fast)):
                return Selection(baseline, "COOLDOWN", cap_missing)
        warm_base = current if slow_base is None else slow_base
        if (elapsed_sec < WARMUP_SEC and not warmup_exempt
                and paces[chosen] > warm_base + WARMUP_SLOW_CAP_SEC_PER_KM + PACE_EPS):
            chosen, reason = self.index_of(warm_base + WARMUP_SLOW_CAP_SEC_PER_KM), "WARMUP_CAP"
        if abs(paces[chosen] - current) < MIN_CHANGE_SEC_PER_KM - PACE_EPS:
            return Selection(baseline, "SMALL_CHANGE", cap_missing)
        return Selection(chosen, reason, cap_missing)
