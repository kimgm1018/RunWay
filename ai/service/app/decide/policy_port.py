"""결정 정책과 모델을 잇는 불변 자료형."""
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from app.decide.schemas import DecideContext
if TYPE_CHECKING:   # app.policy 패키지 초기화와 순환 import를 피한다
    from app.policy.hr_reference import HrThresholds


@dataclass(frozen=True)
class PolicyCandidate:
    delta_sec_per_km: int
    pace_sec_per_km: float
    future_speed_mps: float
    pred_hr_bpm: tuple[float, float, float]
    future_grade_pct: tuple[float | None, ...] | None


@dataclass(frozen=True)
class PolicyInput:
    now: object
    input_age_sec: float
    hr_now_bpm: float | None
    speed_now_mps: float | None
    pace_now_sec_per_km: float | None
    recent_cells: tuple[tuple[float | None, float | None], ...]
    context: DecideContext
    candidates: tuple[PolicyCandidate, ...]
    hr_thresholds: "HrThresholds | None" = None
    # 러너의 실측 속도로 2분을 달린다고 본 예측 심박(30/60/120초). 코칭 단계 판정용, 끄면 None(S15P31E105-504).
    actual_pred_hr_bpm: tuple[float, float, float] | None = None
    # 러너가 안내보다 느릴 때 max(안내, 실측 페이스) + (10, 20, 30, 45, 60)초/km 페이스(같은 GRU 호출로 예측).
    # 있으면 감속 후보는 요청 후보 대신 이 행을 쓴다(S15P31E105-624 수정 1). delta_sec_per_km는 안내 기준.
    slow_rows: tuple["PolicyCandidate", ...] = ()


@dataclass(frozen=True)
class CandidateVerdict:
    upper_hr_bpm: tuple[float | None, float | None, float | None]
    peak_upper_bpm: float | None
    passed: bool
    reject_reason: str | None
    score: float | None


@dataclass(frozen=True)
class PolicyOutput:
    status: str
    action: str
    chosen_index: int | None
    recommended_pace_sec_per_km: float | None
    reason: str | None
    reason_text: str | None
    gate: str | None
    verdicts: tuple[CandidateVerdict, ...]
    publish_suggested: bool
    allow_bpm: float | None = None
    hard_eff_bpm: float | None = None
    hr_danger_bpm: float | None = None
    hr_sustain_bpm: float | None = None
    hr_threshold_source: str | None = None
    hr_threshold_weight: float | None = None
    margin_table_version: str = ""
    actual_minus_guide_sec_per_km: float | None = None
    eta_sec: float | None = None
    eta_minus_goal_sec: float | None = None
    warnings: tuple[str, ...] = ()
    # 러닝 초반 계획 넘겨주기 단계: PLAN_HOLD / PLAN_BLEND / MPC, 계획 비중 w. 기능이 꺼져 있으면 None.
    handover_phase: str | None = None
    plan_weight: float | None = None
    # 코칭 단계 OK / CAUTION / DANGER(S15P31E105-504). 판단이 없거나 정책이 정하지 않으면 None.
    coaching_level: str | None = None
    # 추천 페이스가 요청 후보가 아닐 때(chosen_index=None) 그 페이스의 예측 심박(30/60/120초).
    chosen_pred_hr_bpm: tuple[float, float, float] | None = None


class PacePolicy(Protocol):
    policy_version: str
    input_insufficient_sec: float

    def decide(self, inp: PolicyInput) -> PolicyOutput: ...
