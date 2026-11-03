"""RunWay 공통 사전계획(Pre-run) Planner v1.

v1에서 더한 것(아래 "팀 API·ERD 계약" 절): 팀 API(AI05 초안)·ERD(pace_plans / pace_plan_segments) 형식 출력,
PAC-001 모드(코스 / 목표 있는 자유러닝 / 무목표), {code, message, details} 오류, 출발 전 HR 미리보기(평균 곡선 하나,
validated_prerun_horizon_s까지만, 기본은 표시 안 함). pace 계획 계산은 v0과 같고 HR 예측을 쓰지 않는다.

특정 모델 전용이 아니다. 흐름:

    사용자 목표 + 코스 + 사용자 성향
            ↓
    PreRunPlanner ── pace 계획·후보 생성
            ↓
    PreRunPredictorProtocol (Transformer / GRU adapter가 구현)
            ↓
    예상 HR trajectory (지원할 때만) → 후보 burden 비교용 데이터
            ↓
    최종 사전 pace plan (PreRunPlan, JSON 직렬화 가능)

이 파일은 Transformer·GRU의 구체 클래스를 import하지 않는다. 표준 라이브러리만 쓴다.

pace ratio 정의 (모든 ratio에 공통):
    ratio = 구간 pace(sec/km) / 목표 pace(sec/km)
    1.00 = 목표 pace 그대로, 1.05 = 목표보다 5% 느리게, 0.97 = 목표보다 3% 빠르게.
    base_pace_ratio는 Route 모듈이 경사 등을 반영해 계산해 넘겨준 값이다.
    Planner는 grade→pace 공식을 새로 만들지 않는다. grade_pct는 출력·분석·향후 Predictor 입력용으로만 보존한다.

HR 안전 기준은 이 파일에 없다. HardHR/Capacity가 검증되지 않았으므로 HR 상한·허용치 숫자를 만들지 않는다.
finish release는 pace 계획만 조정한다. 나중에 안전 상한이 생기면 별도 Policy가 hard constraint로 적용한다.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from decimal import Decimal
import math
from typing import Any, Protocol, Sequence, runtime_checkable

PLANNER_VERSION = 'prerun_planner_v1'

# goal_preference: 0 = 목표 거리 완주 우선, 1 = 목표 pace 달성 우선
GOAL_DISTANCE_FIRST = 0.0
GOAL_BALANCED = 0.5          # 완주 가능성과 목표 pace 오차를 같은 무게로 본다
GOAL_PACE_FIRST = 1.0

_SEGMENT_TOL_M = 1e-3        # 구간 경계 허용 오차 1mm


class PredictionStatus:
    """prediction_status 값 (JSON에 문자열 그대로 들어간다)."""

    NO_PREDICTOR = 'NO_PREDICTOR'                                  # predictor 없이 pace 계획만 생성
    UNAVAILABLE_MODEL_CAPABILITY = 'UNAVAILABLE_MODEL_CAPABILITY'  # 모델이 이 Pre-run 조건을 지원하지 않음
    PREDICTED = 'PREDICTED'                                        # 후보 HR trajectory 예측 성공 (순위는 매기지 않음)
    PREDICTION_FAILED = 'PREDICTION_FAILED'                        # 모델 호출 실패·출력 형식 오류
    HR_NOT_VALIDATED = 'HR_NOT_VALIDATED'                          # 모델은 지원하지만 Pre-run HR이 검증되지 않음(H*=0)


def _finite(name: str, value: Any) -> float:
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f'{name}는 유한한 수여야 한다: {value!r}')
    return v


def format_pace(sec_per_km: float) -> str:
    """312.0 → '5:12'."""
    total = int(round(sec_per_km))
    return f'{total // 60}:{total % 60:02d}'


def goal_profile(goal_preference: float) -> str:
    """goal_preference 구간 이름. 0.5는 명시적인 BALANCED다."""
    p = float(goal_preference)
    if p == GOAL_DISTANCE_FIRST:
        return 'DISTANCE_FIRST'
    if p == GOAL_PACE_FIRST:
        return 'PACE_FIRST'
    if math.isclose(p, GOAL_BALANCED, abs_tol=1e-9):
        return 'BALANCED'
    return 'DISTANCE_LEANING' if p < GOAL_BALANCED else 'PACE_LEANING'


def smoothstep(x: float) -> float:
    """[0,1]로 자른 뒤 3x² − 2x³. 양 끝 기울기가 0이라 release가 부드럽게 시작·끝난다."""
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)


def finish_release(progress_ratio: float, start: float) -> float:
    """진행률 start 이전은 0, start → 1.0 구간에서 smoothstep으로 0 → 1."""
    if progress_ratio <= start:
        return 0.0
    return smoothstep((progress_ratio - start) / (1.0 - start))


def effective_pace_priority(goal_preference: float, release: float, kick_strength: float) -> float:
    """goal_preference + (1 − goal_preference) × kick_strength × release, [0,1]로 clamp.
    거리우선 사용자도 목표 거리가 가까워질수록 목표 pace 쪽으로 조금 더 이동한다. HR 기준과는 무관하다."""
    v = goal_preference + (1.0 - goal_preference) * kick_strength * release
    return min(1.0, max(0.0, v))


@dataclass(frozen=True)
class CourseSegment:
    """코스 한 구간. base_pace_ratio = 이 구간 권장 pace / 목표 pace (Route 모듈 계산값)."""

    start_m: float
    end_m: float
    grade_pct: float
    base_pace_ratio: float

    def __post_init__(self):
        start, end = _finite('start_m', self.start_m), _finite('end_m', self.end_m)
        _finite('grade_pct', self.grade_pct)
        ratio = _finite('base_pace_ratio', self.base_pace_ratio)
        if start < 0:
            raise ValueError(f'start_m은 0 이상이어야 한다: {start}')
        if end <= start:
            raise ValueError(f'end_m은 start_m보다 커야 한다: {start} → {end}')
        if ratio <= 0:
            raise ValueError(f'base_pace_ratio는 양수여야 한다: {ratio}')

    @property
    def length_m(self) -> float:
        return self.end_m - self.start_m


@dataclass(frozen=True)
class PreRunRequest:
    """사전계획 입력. goal_preference는 [0,1] (0 거리 완주 우선, 0.5 균형, 1 목표 pace 우선)."""

    target_distance_m: float
    target_pace_sec_per_km: float
    goal_preference: float
    course_segments: Sequence[CourseSegment]
    hr0: float | None = None          # 향후 HR0 지원 모델용. v0 계획 계산에는 쓰지 않는다

    def __post_init__(self):
        distance = _finite('target_distance_m', self.target_distance_m)
        pace = _finite('target_pace_sec_per_km', self.target_pace_sec_per_km)
        pref = _finite('goal_preference', self.goal_preference)
        if distance <= 0:
            raise ValueError(f'target_distance_m은 양수여야 한다: {distance}')
        if pace <= 0:
            raise ValueError(f'target_pace_sec_per_km은 양수여야 한다: {pace}')
        if not 0.0 <= pref <= 1.0:
            raise ValueError(f'goal_preference는 [0, 1] 범위여야 한다: {pref}')
        if self.hr0 is not None and _finite('hr0', self.hr0) <= 0:
            raise ValueError(f'hr0는 양수여야 한다: {self.hr0}')
        segs = tuple(self.course_segments)
        if not segs:
            raise ValueError('course_segments가 비어 있다')
        if not all(isinstance(s, CourseSegment) for s in segs):
            raise ValueError('course_segments는 CourseSegment여야 한다')
        if abs(segs[0].start_m) > _SEGMENT_TOL_M:
            raise ValueError(f'첫 구간은 0m에서 시작해야 한다: {segs[0].start_m}')
        for prev, cur in zip(segs, segs[1:]):
            if abs(cur.start_m - prev.end_m) > _SEGMENT_TOL_M:
                raise ValueError(f'구간이 끊기거나 겹친다: {prev.end_m} → {cur.start_m}')
        if abs(segs[-1].end_m - distance) > _SEGMENT_TOL_M:
            raise ValueError(f'마지막 구간 끝({segs[-1].end_m})이 목표 거리({distance})와 다르다')
        object.__setattr__(self, 'course_segments', segs)


@dataclass(frozen=True)
class PlannerConfig:
    """v0 초기 정책. HR 관련 숫자는 두지 않는다."""

    finish_release_start: float = 0.80                       # 이 진행률부터 reserve를 점진적으로 해제
    finish_kick_strength: float = 0.50                       # release=1일 때 남은 pace 우선도 중 옮겨 가는 비율
    candidate_offsets_sec_per_km: tuple[float, ...] = (-20.0, -10.0, 0.0, 10.0, 20.0)
    use_personalization: bool = True                         # predictor가 지원할 때만 의미 있음
    split_length_m: float = 1000.0                           # 앱 표시용 split 길이 (기본 1km)
    debug_include_unvalidated_hr: bool = False               # 디버그 전용: 검증 시간 밖 HR까지 결과에 넣는다

    def __post_init__(self):
        if not 0.0 <= _finite('finish_release_start', self.finish_release_start) < 1.0:
            raise ValueError('finish_release_start는 [0, 1) 범위여야 한다')
        if not 0.0 <= _finite('finish_kick_strength', self.finish_kick_strength) <= 1.0:
            raise ValueError('finish_kick_strength는 [0, 1] 범위여야 한다')
        if _finite('split_length_m', self.split_length_m) <= 0:
            raise ValueError('split_length_m은 양수여야 한다')
        offsets = tuple(_finite('candidate offset', o) for o in self.candidate_offsets_sec_per_km)
        if 0.0 not in offsets:
            raise ValueError('candidate_offsets_sec_per_km에는 기준 계획(0)이 있어야 한다')
        object.__setattr__(self, 'candidate_offsets_sec_per_km', offsets)


@dataclass(frozen=True)
class PlannedSegment:
    start_m: float
    end_m: float
    grade_pct: float
    base_pace_ratio: float            # Route 입력 그대로
    normalized_pace_ratio: float      # base / 거리 가중 평균 base (평균 pace = 목표 pace)
    planned_pace_ratio: float         # eff × normalized + (1 − eff) × base
    progress_ratio: float             # 구간 중앙 거리 / 목표 거리
    finish_release: float             # 0 → 1 (마지막 20%에서 smoothstep)
    effective_pace_priority: float    # goal_preference에 finish release를 더한 값
    target_pace_sec_per_km: float     # 목표 pace × planned_pace_ratio
    length_m: float
    segment_time_s: float


@dataclass(frozen=True)
class KmSplit:
    """앱 표시용 거리 split(기본 1km). Route 구간 경계가 km와 달라도 split 안에서 걸리는 시간으로 pace를 낸다.

    pace_ratio = split pace / 목표 pace = split 안 구간 planned ratio의 거리 가중 평균.
    목표 pace가 바뀌어도 그대로이므로 backend는 pace_ratio × 목표 pace로 다시 계산할 수 있다.
    """

    index: int                        # 1부터
    start_m: float
    end_m: float
    length_m: float
    is_partial: bool                  # split 길이보다 짧은 마지막 구간 (예: 마라톤 마지막 195m)
    grade_pct: float                  # 거리 가중 평균 경사
    pace_ratio: float
    target_pace_sec_per_km: float
    split_time_s: float
    cumulative_time_s: float


@dataclass(frozen=True)
class PaceCandidate:
    """기준 계획의 모든 구간 pace에 같은 offset(sec/km)을 더한 후보. 코스 모양은 유지된다."""

    offset_sec_per_km: float
    segment_paces_sec_per_km: tuple[float, ...]
    expected_finish_time_s: float


@dataclass(frozen=True)
class HRBurden:
    """HR trajectory 요약. 상대 비교용이며 안전 판정을 하지 않는다."""

    peak_hr_bpm: float
    mean_hr_bpm: float
    hr_auc_bpm_s: float               # Σ HR × sample_interval_s


@dataclass(frozen=True)
class CandidatePrediction:
    offset_sec_per_km: float
    sample_interval_s: int
    hr_trajectory_bpm: tuple[float, ...]
    burden: HRBurden


@dataclass(frozen=True)
class HRPredictionSummary:
    model_name: str
    model_version: str
    personalized: bool
    hr0_used: bool
    candidates: tuple[CandidatePrediction, ...]
    ranking_status: str = 'NOT_RANKED_NO_POLICY'   # 안전·순위 정책은 별도 Policy 모듈 담당 (v0 없음)
    model_warnings: tuple[str, ...] = ()           # adapter가 알린 모델 한계 (예: 0초 시작은 학습 분포 밖)
    validated_horizon_s: float | None = None       # 궤적은 이 시간까지만 들어 있다(debug_unvalidated면 전체)
    debug_unvalidated: bool = False                # True면 검증 시간 밖 HR이 섞여 있다. 서비스 화면에 쓰지 않는다


@dataclass(frozen=True)
class PreRunPlan:
    target_distance_m: float
    target_pace_sec_per_km: float
    goal_preference: float
    goal_profile: str
    course_mean_base_ratio: float
    expected_finish_time_s: float
    expected_avg_pace_sec_per_km: float
    segments: tuple[PlannedSegment, ...]
    km_splits: tuple[KmSplit, ...]
    candidates: tuple[PaceCandidate, ...]
    prediction_status: str
    hr_prediction: HRPredictionSummary | None
    warnings: tuple[str, ...]
    predictor: dict | None
    config: dict
    planner_version: str = PLANNER_VERSION

    def to_dict(self) -> dict:
        """backend용 JSON 호환 dict (tuple → list)."""
        return _jsonable(asdict(self))


def _jsonable(obj):
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


# ── Predictor 공통 계약 ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PreRunCapabilities:
    """Pre-run 전용 capability. adapter는 이 flag들을 가진 객체를 capabilities로 돌려준다.

    기존 runway_ai PredictorCapabilities의 supports_pre_run 하나로는 'HR0 없음'과 'HR0 있음'을 구분할 수 없다.
    그래서 Planner는 아래 flag가 없는 capability를 '지원하지 않음'으로 본다.
    """

    supports_pre_run_no_hr: bool = False       # history 0초 + HR0 없음
    supports_pre_run_hr0: bool = False         # history 0초 + 출발 전 HR0 1개
    supports_full_trajectory: bool = False     # 출발~완주 모든 sample_interval_s 칸의 HR을 낸다
    supports_personalization: bool = False
    sample_interval_s: int = 5
    # Pre-run 검증으로 믿을 수 있다고 확인된 출발 후 시간(초). 0 = 미검증 → Planner가 HR을 보여 주지 않는다.
    # 값이 없는 capability도 0으로 본다. 근거(실험·run id)는 validation_ref에 적는다.
    validated_prerun_horizon_s: float = 0.0
    validation_ref: str = ''


@dataclass(frozen=True)
class PreRunSimulationRequest:
    """adapter 입력. 후보마다 출발부터 완주까지의 action을 sample_interval_s 격자로 준다.

    future_speed_mps / future_grade_pct는 후보별 길이가 다를 수 있다(빠른 후보는 더 일찍 끝난다).
    기존 HRPredictor batch의 future_speed / future_grade와 같은 단위(m/s, %)다.
    """

    candidates: tuple[PaceCandidate, ...]
    future_speed_mps: tuple[tuple[float, ...], ...]
    future_grade_pct: tuple[tuple[float, ...], ...]
    sample_interval_s: int
    hr0_bpm: float | None
    personalized: bool


@dataclass(frozen=True)
class PreRunSimulationResult:
    """adapter 출력. hr_bpm[i][k] = 후보 i의 k번째 격자 끝 시점 절대 HR(bpm)."""

    hr_bpm: tuple[tuple[float, ...], ...]
    model_name: str
    model_version: str
    personalized: bool
    warnings: tuple[str, ...] = ()             # 모델 한계 안내. Planner가 plan.warnings에 그대로 옮긴다


@runtime_checkable
class PreRunPredictorProtocol(Protocol):
    """Transformer·GRU adapter가 구현할 Pre-run 계약. Planner는 이 Protocol만 안다.

    Python 3.12의 runtime_checkable isinstance는 멤버가 있는지만 본다(inspect.getattr_static).
    capability 값과 출력 형식은 Planner가 따로 검증한다.
    """

    @property
    def capabilities(self) -> Any: ...

    def simulate_pre_run(self, request: PreRunSimulationRequest) -> PreRunSimulationResult: ...


def _capability(caps: Any, name: str) -> bool:
    return bool(getattr(caps, name, False)) if caps is not None else False


def _validated_horizon(caps: Any) -> float:
    """검증된 Pre-run 시간(초). 없거나 음수·유한하지 않으면 0(미검증)."""
    try:
        h = float(getattr(caps, 'validated_prerun_horizon_s', 0.0) or 0.0)
    except (TypeError, ValueError):
        return 0.0
    return h if math.isfinite(h) and h > 0 else 0.0


def pace_plan_to_time_grid(segments: Sequence[Any], paces_sec_per_km: Sequence[float], interval_s: int) -> tuple:
    """거리 구간 pace 계획 → interval_s 격자의 (speed m/s, grade %). 각 칸은 칸 중앙 시점이 속한 구간 값을 쓴다."""
    if interval_s <= 0:
        raise ValueError('interval_s는 양수여야 한다')
    bounds, t = [], 0.0
    for s, pace in zip(segments, paces_sec_per_km):
        if pace <= 0:
            raise ValueError(f'pace는 양수여야 한다: {pace}')
        t += (s.end_m - s.start_m) / 1000.0 * pace
        bounds.append(t)
    n = math.ceil(bounds[-1] / interval_s - 1e-9)
    speed, grade, j = [], [], 0
    for k in range(n):
        mid = (k + 0.5) * interval_s
        while j < len(bounds) - 1 and mid > bounds[j]:
            j += 1
        speed.append(1000.0 / paces_sec_per_km[j])
        grade.append(float(segments[j].grade_pct))
    return tuple(speed), tuple(grade)


def distance_splits(planned: Sequence[PlannedSegment], target_pace_sec_per_km: float, total_m: float,
                    split_length_m: float) -> tuple[KmSplit, ...]:
    """구간 계획 → split_length_m 단위 split. 각 split의 시간 = Σ(겹친 거리 × 그 구간 pace)."""
    out, cumulative, k = [], 0.0, 0
    while k * split_length_m < total_m - _SEGMENT_TOL_M:
        start, end = k * split_length_m, min((k + 1) * split_length_m, total_m)
        time_s = grade = 0.0
        for s in planned:
            overlap = min(end, s.end_m) - max(start, s.start_m)
            if overlap > 0:
                time_s += overlap / 1000.0 * s.target_pace_sec_per_km
                grade += overlap * s.grade_pct
        length = end - start
        pace = time_s / (length / 1000.0)
        cumulative += time_s
        k += 1
        out.append(KmSplit(index=k, start_m=start, end_m=end, length_m=length,
                           is_partial=length < split_length_m - _SEGMENT_TOL_M, grade_pct=grade / length,
                           pace_ratio=pace / target_pace_sec_per_km, target_pace_sec_per_km=pace, split_time_s=time_s,
                           cumulative_time_s=cumulative))
    return tuple(out)


def _burden(hr: Sequence[float], interval_s: int) -> HRBurden:
    return HRBurden(peak_hr_bpm=float(max(hr)), mean_hr_bpm=float(sum(hr) / len(hr)),
                    hr_auc_bpm_s=float(sum(hr) * interval_s))


# ── Planner ───────────────────────────────────────────────────────────────────────────

class PreRunPlanner:
    """모델 독립 사전계획기. predictor는 None이거나 PreRunPredictorProtocol 구현체다."""

    def __init__(self, predictor: PreRunPredictorProtocol | None = None, config: PlannerConfig | None = None):
        if predictor is not None and not isinstance(predictor, PreRunPredictorProtocol):
            raise TypeError('predictor는 capabilities와 simulate_pre_run을 가진 PreRunPredictorProtocol 구현체여야 한다')
        self.predictor = predictor
        self.config = config or PlannerConfig()

    def plan(self, request: PreRunRequest) -> PreRunPlan:
        cfg = self.config
        segs = request.course_segments
        total = request.target_distance_m
        mean_base = sum(s.length_m * s.base_pace_ratio for s in segs) / total
        planned = []
        for s in segs:
            normalized = s.base_pace_ratio / mean_base
            progress = (s.start_m + s.end_m) / 2.0 / total
            release = finish_release(progress, cfg.finish_release_start)
            eff = effective_pace_priority(request.goal_preference, release, cfg.finish_kick_strength)
            ratio = eff * normalized + (1.0 - eff) * s.base_pace_ratio
            pace = request.target_pace_sec_per_km * ratio
            planned.append(PlannedSegment(
                start_m=s.start_m, end_m=s.end_m, grade_pct=s.grade_pct, base_pace_ratio=s.base_pace_ratio,
                normalized_pace_ratio=normalized, planned_pace_ratio=ratio, progress_ratio=progress,
                finish_release=release, effective_pace_priority=eff, target_pace_sec_per_km=pace,
                length_m=s.length_m, segment_time_s=s.length_m / 1000.0 * pace))
        finish = sum(p.segment_time_s for p in planned)
        candidates = tuple(self._candidate(planned, off) for off in cfg.candidate_offsets_sec_per_km)
        status, prediction, warnings = self._predict(request, planned, candidates)
        caps = self.predictor.capabilities if self.predictor is not None else None
        predictor_info = None if self.predictor is None else {
            **{name: _capability(caps, name) for name in ('supports_pre_run_no_hr', 'supports_pre_run_hr0',
                                                          'supports_full_trajectory', 'supports_personalization')},
            'validated_prerun_horizon_s': _validated_horizon(caps),
            'validation_ref': str(getattr(caps, 'validation_ref', '') or '')}
        return PreRunPlan(
            target_distance_m=total, target_pace_sec_per_km=request.target_pace_sec_per_km,
            goal_preference=request.goal_preference, goal_profile=goal_profile(request.goal_preference),
            course_mean_base_ratio=mean_base, expected_finish_time_s=finish,
            expected_avg_pace_sec_per_km=finish / (total / 1000.0), segments=tuple(planned),
            km_splits=distance_splits(planned, request.target_pace_sec_per_km, total, cfg.split_length_m),
            candidates=candidates,
            prediction_status=status, hr_prediction=prediction, warnings=tuple(warnings), predictor=predictor_info,
            config=asdict(cfg))

    @staticmethod
    def _candidate(planned: Sequence[PlannedSegment], offset: float) -> PaceCandidate:
        paces = tuple(p.target_pace_sec_per_km + offset for p in planned)
        if min(paces) <= 0:
            raise ValueError(f'offset {offset} sec/km 후보의 pace가 0 이하가 된다')
        return PaceCandidate(offset_sec_per_km=offset, segment_paces_sec_per_km=paces,
                             expected_finish_time_s=sum(p.length_m / 1000.0 * v for p, v in zip(planned, paces)))

    def _predict(self, request: PreRunRequest, planned, candidates) -> tuple:
        """predictor가 이 Pre-run 조건을 지원할 때만 호출한다. 지원하지 않으면 HR을 만들지 않는다(None)."""
        if self.predictor is None:
            return PredictionStatus.NO_PREDICTOR, None, ['predictor가 없어 HR 예측 없이 pace 계획만 만들었다']
        caps = self.predictor.capabilities
        no_hr, with_hr0 = _capability(caps, 'supports_pre_run_no_hr'), _capability(caps, 'supports_pre_run_hr0')
        warnings, hr0 = [], None
        if request.hr0 is not None and with_hr0:
            hr0 = request.hr0
        elif request.hr0 is not None and no_hr:
            warnings.append('모델이 HR0 입력을 지원하지 않아 HR0 없이 Pre-run 예측을 요청했다')
        elif not no_hr:
            need = 'HR0 있는 Pre-run' if request.hr0 is not None else 'HR0 없는 Pre-run(history 0초)'
            return (PredictionStatus.UNAVAILABLE_MODEL_CAPABILITY, None,
                    [f'현재 모델은 {need}을 지원하지 않아 HR 예측을 하지 않았다. pace 계획만 제공한다'])
        if not _capability(caps, 'supports_full_trajectory'):
            return (PredictionStatus.UNAVAILABLE_MODEL_CAPABILITY, None,
                    ['현재 모델은 출발부터 완주까지 전체 HR 궤적을 내지 못해 burden을 계산할 수 없다. pace 계획만 제공한다'])
        interval = int(getattr(caps, 'sample_interval_s', 5))
        horizon = _validated_horizon(caps)
        ref = str(getattr(caps, 'validation_ref', '') or '') or '검증 기록 없음'
        n_valid = int(math.floor(horizon / interval + 1e-9))
        debug = self.config.debug_include_unvalidated_hr
        if n_valid == 0:
            warnings.append(f'Pre-run HR 미검증(H*=0): HR을 보여 주지 않는다. 검증 근거: {ref}. pace 계획만 제공한다')
            if not debug:
                return PredictionStatus.HR_NOT_VALIDATED, None, warnings
        grids = [pace_plan_to_time_grid(planned, c.segment_paces_sec_per_km, interval) for c in candidates]
        personalized = bool(self.config.use_personalization and _capability(caps, 'supports_personalization'))
        sim_request = PreRunSimulationRequest(candidates=candidates, future_speed_mps=tuple(g[0] for g in grids),
                                              future_grade_pct=tuple(g[1] for g in grids), sample_interval_s=interval,
                                              hr0_bpm=hr0, personalized=personalized)
        try:
            result = self.predictor.simulate_pre_run(sim_request)
            hr = [tuple(float(v) for v in row) for row in result.hr_bpm]
            if len(hr) != len(candidates):
                raise ValueError(f'후보 {len(candidates)}개에 HR {len(hr)}개가 돌아왔다')
            for row, g in zip(hr, grids):
                if len(row) != len(g[0]) or not all(math.isfinite(v) and v > 0 for v in row):
                    raise ValueError('HR trajectory 길이나 값이 올바르지 않다')
            model_warnings = tuple(str(w) for w in getattr(result, 'warnings', ()))
        except Exception as e:  # noqa: BLE001 - 모델 실패가 pace 계획을 막지 않게 한다
            return PredictionStatus.PREDICTION_FAILED, None, warnings + [f'HR 예측 실패: {type(e).__name__}: {e}']
        shown = hr if debug else [row[:n_valid] for row in hr]
        summary = HRPredictionSummary(
            model_name=str(result.model_name), model_version=str(result.model_version),
            personalized=bool(result.personalized), hr0_used=hr0 is not None,
            candidates=tuple(CandidatePrediction(offset_sec_per_km=c.offset_sec_per_km, sample_interval_s=interval,
                                                 hr_trajectory_bpm=row, burden=_burden(row, interval))
                             for c, row in zip(candidates, shown)),
            model_warnings=model_warnings, validated_horizon_s=horizon, debug_unvalidated=debug)
        warnings.extend(model_warnings)
        if debug:
            warnings.append(f'디버그: 검증 시간(출발 후 {horizon / 60:g}분) 밖 HR까지 넣었다. 서비스 화면에 쓰지 않는다. '
                            f'검증 근거: {ref}')
        elif any(len(row) > n_valid for row in hr):
            warnings.append(f'HR은 검증된 {horizon / 60:g}분까지만 보여 준다(검증 근거: {ref}). burden도 그 구간으로 계산했다')
        warnings.append('HR 후보는 비교용 burden(peak·mean·AUC)만 제공한다. 안전 판정과 순위는 아직 없다')
        status = PredictionStatus.PREDICTED if n_valid > 0 else PredictionStatus.HR_NOT_VALIDATED
        return status, summary, warnings


# ── 팀 API·ERD 계약 (Planner v1) ─────────────────────────────────────────────────────────
#
# 요청·응답 필드는 camelCase + 단위 접미사(팀 API 규칙), 저장 행은 schema.sql 이름 그대로다.
#   응답 segments[]  = 1km split(마지막은 짧을 수 있음)  → pace_plan_segments(segment_sequence, start_distance,
#                                                         end_distance, recommended_pace)
#   응답 계획 필드     → pace_plans(recommended_pace = 계획 평균 pace, cue_bpm = null, route_progress = null)
#   ratio            = 구간 pace / 목표 pace (v0과 같은 정의)
# 모드 enum 이름·cue_bpm 계산 주체는 팀 합의 전이라 임시값이다(docs/STATUS.md 7절 N7).

class RunMode:
    """PAC-001 러닝 모드. 요청 값으로 정한다(gradeProfile → 코스, 목표 값 → 목표 있는 자유러닝, 없음 → 무목표)."""

    COURSE = 'COURSE'                    # 코스 지정: 코스 경사(gradeProfile)로 계획
    FREE_WITH_GOAL = 'FREE_WITH_GOAL'    # 목표 있는 자유러닝: 미래 경사 0%(평지)로 계획
    FREE_NO_GOAL = 'FREE_NO_GOAL'        # 무목표 자유러닝: 사전 계획을 만들지 않는다


API_CONFIG = PlannerConfig(candidate_offsets_sec_per_km=(0.0,))   # 미리보기는 추천 계획 곡선 하나만 굴린다
COURSE_DISTANCE_TOL_M = 1.0              # 목표 거리와 코스 길이 비교 허용 오차(목표 거리는 정수 m)
GOAL_TIME_TOL_S = 1.0                    # 목표 거리·시간·pace 세 값이 서로 맞는지 볼 때 허용 오차(정수 초 반올림)
HR_PREVIEW_PEAK_NOTE = ('평균 곡선만 보여 준다. 세션 최고 HR은 실측보다 9~10 bpm 낮게 보는 경향이 있다 '
                        '(Pre-run 검증: LightGBM ON 중앙값 −10, B_THS_pers −8.8 bpm)')


class PlanApiError(Exception):
    """HTTP 상태 + 팀 공통 오류 형태 {code, message, details: {fields: [{name, reason}]}}. 거절한 값은 넣지 않는다."""

    def __init__(self, status: int, code: str, message: str, fields=()):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.fields = [dict(name=n, reason=r) for n, r in fields]

    def to_dict(self) -> dict:
        return dict(code=self.code, message=self.message, details=dict(fields=self.fields))


class NoHRPreview:
    """기본 HR 미리보기 공급자 = 표시 안 함. capability는 통과하지만 검증 시간이 0이라 Planner가 부르지 않는다."""

    provider_name = None
    capabilities = PreRunCapabilities(supports_pre_run_no_hr=True, supports_pre_run_hr0=True,
                                      supports_full_trajectory=True, validated_prerun_horizon_s=0.0,
                                      validation_ref='기본 설정: HR 미리보기 공급자를 고르지 않음(표시 안 함)')

    def simulate_pre_run(self, request: PreRunSimulationRequest) -> PreRunSimulationResult:
        raise AssertionError('검증 시간이 0인 공급자는 호출되면 안 된다')


NO_HR_PREVIEW = NoHRPreview()


def _warning(code: str, message: str) -> dict:
    return dict(code=code, message=message)


def _r2(x: float) -> float:
    """SQL NUMERIC(…,2)에 맞춰 소수 둘째 자리로. −0.0은 0.0으로."""
    return round(float(x), 2) + 0.0


def _number(body: dict, name: str, errors: list) -> float | None:
    return _as_number(body.get(name), name, errors)


def _as_number(value, name: str, errors: list) -> float | None:
    """None → None. 숫자(bool 제외)이고 유한해야 한다. 틀리면 errors에 (이름, 사유)를 넣는다."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append((name, '숫자여야 한다'))
        return None
    try:
        v = float(value)
    except (OverflowError, ValueError):
        errors.append((name, '계산 가능한 숫자 범위를 벗어났다'))
        return None
    if not math.isfinite(v):
        errors.append((name, '유한한 숫자여야 한다'))
        return None
    return v


def _parse_profile(profile, errors: list):
    """gradeProfile → (CourseSegment tuple, Route ratio 유무). 형식 오류는 errors에 넣고 (None, False)."""
    if not isinstance(profile, list) or not profile:
        errors.append(('gradeProfile', '구간 객체 배열이어야 하고 비어 있으면 안 된다'))
        return None, False
    rows, with_ratio = [], 0
    for i, item in enumerate(profile):
        p = f'gradeProfile[{i}]'
        if not isinstance(item, dict):
            errors.append((p, '객체여야 한다'))
            continue
        row = {}
        for key in ('startDistanceM', 'endDistanceM', 'gradePercent'):
            if item.get(key) is None:
                errors.append((f'{p}.{key}', '필수 값이다'))
            else:
                row[key] = _as_number(item[key], f'{p}.{key}', errors)
        if item.get('basePaceRatio') is not None:
            with_ratio += 1
            r = _as_number(item['basePaceRatio'], f'{p}.basePaceRatio', errors)
            if r is not None and r <= 0:
                errors.append((f'{p}.basePaceRatio', '양수여야 한다'))
            row['basePaceRatio'] = r
        rows.append(row)
    if errors:
        return None, False
    if 0 < with_ratio < len(rows):
        errors.append(('gradeProfile[].basePaceRatio', '모든 구간에 주거나 모두 생략해야 한다'))
        return None, False
    segs = []
    for i, row in enumerate(rows):
        try:
            segs.append(CourseSegment(row['startDistanceM'], row['endDistanceM'], row['gradePercent'],
                                      row.get('basePaceRatio') or 1.0))
        except ValueError:
            errors.append((f'gradeProfile[{i}]', '시작 거리는 0 이상, 끝 거리는 시작보다 커야 한다'))
    if errors:
        return None, False
    if abs(segs[0].start_m) > _SEGMENT_TOL_M or any(abs(b.start_m - a.end_m) > _SEGMENT_TOL_M
                                                     for a, b in zip(segs, segs[1:])):
        errors.append(('gradeProfile', '0m에서 시작해 끊김·겹침 없이 이어져야 한다'))
        return None, False
    return tuple(segs), with_ratio > 0


def _parse(body) -> dict:
    """400 VALIDATION_ERROR 검사(형식·범위). 목표 조합 검사는 _resolve_goal(422)."""
    if not isinstance(body, dict):
        raise PlanApiError(400, 'VALIDATION_ERROR', '요청 본문은 JSON 객체여야 한다.', [('body', 'JSON 객체여야 한다')])
    raw_distance = body.get('targetDistanceM')
    if isinstance(raw_distance, int) and not isinstance(raw_distance, bool):
        if raw_distance <= 0:
            raise PlanApiError(422, 'INVALID_GOAL', '목표 값은 양수여야 한다.',
                               [('targetDistanceM', '양수여야 한다')])
        if raw_distance > 45000:
            raise PlanApiError(422, 'INVALID_GOAL', '목표 거리는 45000m 이하여야 한다.',
                               [('targetDistanceM', '목표 거리는 45000m 이하여야 한다')])
    raw_duration = body.get('targetDurationSec')
    if isinstance(raw_duration, int) and not isinstance(raw_duration, bool):
        if raw_duration <= 0:
            raise PlanApiError(422, 'INVALID_GOAL', '목표 값은 양수여야 한다.',
                               [('targetDurationSec', '양수여야 한다')])
        try:
            float(raw_duration)
        except OverflowError:
            raise PlanApiError(422, 'INVALID_GOAL', '목표 시간이 계획 계산 범위를 벗어났다.',
                               [('targetDurationSec', '계산 가능한 목표 시간을 입력해야 한다')]) from None
    errors = []
    course_id = body.get('courseId')
    if course_id is not None and (isinstance(course_id, bool) or not isinstance(course_id, int) or course_id <= 0):
        errors.append(('courseId', '양의 정수여야 한다'))
    targets = {k: _number(body, k, errors) for k in ('targetDistanceM', 'targetDurationSec', 'targetPaceSecPerKm')}
    target_pace = targets['targetPaceSecPerKm']
    if target_pace is not None and Decimal(str(target_pace)).as_tuple().exponent < -2:
        errors.append(('targetPaceSecPerKm', '소수 둘째 자리까지만 허용한다'))
    avg = _number(body, 'averagePaceSecPerKm', errors)
    if avg is not None and avg <= 0:
        errors.append(('averagePaceSecPerKm', '양수여야 한다'))
    pref = _number(body, 'goalPreference', errors)
    if pref is not None and pref != 0.5:
        errors.append(('goalPreference', 'v0 공개 API는 0.5만 허용한다'))
    hr0 = _number(body, 'hr0Bpm', errors)
    if hr0 is not None and hr0 <= 0:
        errors.append(('hr0Bpm', '양수여야 한다'))
    segs, with_ratio = None, False
    if body.get('gradeProfile') is not None:
        segs, with_ratio = _parse_profile(body['gradeProfile'], errors)
    elif course_id is not None:
        errors.append(('gradeProfile', '코스 모드에는 코스 경사 구간이 필요하다'))
    if errors:
        raise PlanApiError(400, 'VALIDATION_ERROR', '요청 값이 유효하지 않다.', errors)
    if body.get('gradeProfile') is not None:
        mode = RunMode.COURSE
    elif any(v is not None for v in targets.values()):
        mode = RunMode.FREE_WITH_GOAL
    else:
        mode = RunMode.FREE_NO_GOAL
    return dict(mode=mode, targets=targets, average_pace=avg, goal_preference=GOAL_BALANCED if pref is None else pref,
                hr0=hr0, segments=segs, with_ratio=with_ratio)


def _resolve_goal(req: dict) -> tuple:
    """(목표 거리 m, 목표 pace 초/km, pace 출처, 경고). 순서: 목표 pace → 목표 시간/거리 → 프로필 평소 pace."""
    t = req['targets']
    supplied = [name for name, value in t.items() if value is not None]
    if len(supplied) > 2:
        raise PlanApiError(422, 'INVALID_GOAL', '거리·시간·페이스 목표는 최대 두 개까지 지정할 수 있다.',
                           [(name, '목표 값은 최대 두 개까지 지정할 수 있다') for name in supplied])
    bad = [(k, '양수여야 한다') for k, v in t.items() if v is not None and v <= 0]
    if bad:
        raise PlanApiError(422, 'INVALID_GOAL', '목표 값은 양수여야 한다.', bad)
    distance, duration, pace = t['targetDistanceM'], t['targetDurationSec'], t['targetPaceSecPerKm']
    if distance is not None and distance > 45000:
        raise PlanApiError(422, 'INVALID_GOAL', '목표 거리는 45000m 이하여야 한다.',
                           [('targetDistanceM', '목표 거리는 45000m 이하여야 한다')])
    warnings = []
    if req['mode'] == RunMode.COURSE:
        course_m = req['segments'][-1].end_m
        if distance is not None and abs(distance - course_m) > COURSE_DISTANCE_TOL_M:
            raise PlanApiError(422, 'INVALID_GOAL', '목표 거리가 코스 길이와 다르다.',
                               [('targetDistanceM', '코스 길이와 같아야 한다')])
        distance = course_m
    if pace is not None:
        source = 'TARGET_PACE'
    elif duration is not None and distance is not None:
        pace, source = duration / (distance / 1000.0), 'TARGET_DURATION'
    elif req['average_pace'] is not None:
        pace, source = req['average_pace'], 'PROFILE_AVERAGE_PACE'
        warnings.append(_warning('TARGET_PACE_FROM_PROFILE', '목표 pace·시간이 없어 프로필 평소 pace로 계획했다'))
    else:
        raise PlanApiError(422, 'INVALID_GOAL', '계획할 pace 기준이 없다.',
                           [('targetPaceSecPerKm', '목표 pace, 목표 시간(거리와 함께) 또는 평소 pace가 필요하다')])
    if distance is None:
        if duration is None:
            raise PlanApiError(422, 'INVALID_GOAL', '계획할 거리 기준이 없다.',
                               [('targetDistanceM', '목표 거리 또는 목표 시간이 필요하다')])
        distance = duration / pace * 1000.0
        warnings.append(_warning('DISTANCE_FROM_DURATION', '목표 거리가 없어 목표 시간 ÷ pace로 거리를 정했다'))
    elif duration is not None and t['targetPaceSecPerKm'] is not None \
            and abs(duration - distance / 1000.0 * pace) > GOAL_TIME_TOL_S:
        raise PlanApiError(422, 'INVALID_GOAL', '목표 거리·시간·pace가 서로 맞지 않는다.',
                           [('targetDurationSec', '목표 거리 × 목표 pace와 같아야 한다'),
                            ('targetPaceSecPerKm', '목표 시간 ÷ 목표 거리와 같아야 한다')])
    return distance, pace, source, warnings


def _distance_at(planned: Sequence[PlannedSegment], t: float) -> float:
    """계획대로 달릴 때 출발 t초 뒤 거리(m). 완주 뒤는 목표 거리."""
    elapsed = 0.0
    for s in planned:
        if t <= elapsed + s.segment_time_s:
            return s.start_m + (t - elapsed) / s.target_pace_sec_per_km * 1000.0
        elapsed += s.segment_time_s
    return planned[-1].end_m


def _hr_preview(plan: PreRunPlan, predictor, hr0: float | None) -> dict:
    """plan.hr_prediction → hrPreview(평균 곡선 하나). 검증 시간 밖·미검증 HR은 넣지 않는다."""
    caps = predictor.capabilities
    horizon = _validated_horizon(caps)
    ref = str(getattr(caps, 'validation_ref', '') or '') or '검증 기록 없음'
    out = dict(status=plan.prediction_status, provider=getattr(predictor, 'provider_name', None), modelName=None,
               modelVersion=None, personalized=None, validatedHorizonSec=float(horizon), validationRef=ref,
               sampleIntervalSec=None, curve='MEAN', points=[], warnings=[])
    status, w = plan.prediction_status, out['warnings']
    if status == PredictionStatus.HR_NOT_VALIDATED:
        w.append(_warning('HR_NOT_VALIDATED', f'검증된 출발 전 HR 시간이 0이라 HR 미리보기를 보여 주지 않는다. 검증 근거: {ref}'))
    elif status == PredictionStatus.UNAVAILABLE_MODEL_CAPABILITY:
        if hr0 is None and _capability(caps, 'supports_pre_run_hr0') and not _capability(caps, 'supports_pre_run_no_hr'):
            w.append(_warning('HR0_REQUIRED', '출발 전 HR0(hr0Bpm)가 없어 HR 미리보기를 만들지 않았다'))
        else:
            w.append(_warning('HR_PREVIEW_UNAVAILABLE', plan.warnings[-1]))
    elif status == PredictionStatus.PREDICTION_FAILED:
        w.append(_warning('HR_PREVIEW_FAILED', plan.warnings[-1]))
    elif status == PredictionStatus.PREDICTED:
        hp = plan.hr_prediction
        cand = next(c for c in hp.candidates if c.offset_sec_per_km == 0.0)
        interval = cand.sample_interval_s
        out.update(modelName=hp.model_name, modelVersion=hp.model_version, personalized=hp.personalized,
                   sampleIntervalSec=interval,
                   points=[dict(elapsedSec=(k + 1) * interval,
                                distanceM=_r2(_distance_at(plan.segments, (k + 1) * interval)), hrBpm=_r2(v))
                           for k, v in enumerate(cand.hr_trajectory_bpm)])
        w.append(_warning('PEAK_HR_UNDERESTIMATED', HR_PREVIEW_PEAK_NOTE))
        n_total = math.ceil(plan.expected_finish_time_s / interval - 1e-9)
        if len(out['points']) < n_total:
            w.append(_warning('HR_PREVIEW_TRUNCATED', f'HR은 검증된 출발 후 {horizon / 60:g}분까지만 보여 준다. '
                                                      f'그 뒤는 pace 계획만 있다. 검증 근거: {ref}'))
        w.extend(_warning('MODEL_NOTE', m) for m in hp.model_warnings)
    return out


def _segment_difficulty_ratios(segments: tuple[PlannedSegment, ...], total_distance_m: float) -> list[float]:
    """코스 지형 기준 normalized_pace_ratio를 1km 구간으로 거리 가중 평균한다."""
    distance = float(total_distance_m)
    count = min(math.ceil(distance / 1000.0), 45)
    ratios = []
    for index in range(count):
        start = index * 1000.0
        end = distance if index == count - 1 else min(distance, (index + 1) * 1000.0)
        weighted_ratio = 0.0
        covered_m = 0.0
        for segment in segments:
            overlap_m = max(0.0, min(end, segment.end_m) - max(start, segment.start_m))
            if overlap_m:
                weighted_ratio += overlap_m * segment.normalized_pace_ratio
                covered_m += overlap_m
        # Course profiles normally cover the full route. Keep a positive neutral value if a
        # partial profile leaves a split without any terrain input.
        ratio = weighted_ratio / covered_m if covered_m else 1.0
        ratios.append(round(ratio, 6) + 0.0)
    return ratios


def plan_api(body, predictor=None, config: PlannerConfig | None = None) -> tuple[int, dict]:
    """AI05 사전 페이스 계획: 요청 dict → (HTTP 상태, 응답 dict 또는 오류 dict).

    predictor는 HR 미리보기 공급자(PreRunPredictorProtocol). None이면 표시 안 함(HR_NOT_VALIDATED).
    pace 계획은 공급자와 무관하게 같다(HR 예측을 계획에 쓰지 않는다).
    """
    config = config or API_CONFIG
    if config.debug_include_unvalidated_hr:
        raise ValueError('API 응답에는 검증 시간 밖 HR(디버그)을 넣지 않는다')
    predictor = predictor if predictor is not None else NO_HR_PREVIEW
    try:
        req = _parse(body)
        if req['mode'] == RunMode.FREE_NO_GOAL:
            return 200, dict(plannerVersion=PLANNER_VERSION, mode=req['mode'], planStatus='NOT_PROVIDED',
                             targetDistanceM=None, targetPaceSecPerKm=None, targetPaceSource=None,
                             goalPreference=req['goal_preference'], recommendedPaceSecPerKm=None, cueBpm=None,
                             routeProgressM=None, predictedFinishSec=None, segments=[], segmentDifficultyRatios=[], hrPreview=None,
                             warnings=[_warning('NO_PLAN_NO_GOAL', '무목표 자유러닝은 사전 계획을 만들지 않는다(PAC-001)')])
        distance, pace, source, warnings = _resolve_goal(req)
        if req['mode'] == RunMode.COURSE:
            segs = req['segments']
            if not req['with_ratio']:
                warnings.append(_warning('COURSE_PACE_RATIO_MISSING', '코스 구간에 Route pace 비율(basePaceRatio)이 없어 '
                                                                      '경사와 관계없이 균등 pace로 계획했다. 경사는 HR 미리보기 입력에만 쓴다'))
        else:
            segs = (CourseSegment(0.0, distance, 0.0, 1.0),)
            warnings.insert(0, _warning('FLAT_ASSUMED', '목표 있는 자유러닝은 미래 경사 0%(평지)로 계획한다(PAC-001)'))
        plan = PreRunPlanner(predictor=predictor, config=config).plan(PreRunRequest(
            target_distance_m=distance, target_pace_sec_per_km=pace, goal_preference=req['goal_preference'],
            course_segments=segs, hr0=req['hr0']))
        warnings.append(_warning('CUE_BPM_NOT_COMPUTED', 'cue_bpm 계산 기준이 아직 정해지지 않아 null로 둔다'))
        segments = [dict(segmentSequence=k.index, startDistanceM=_r2(k.start_m), endDistanceM=_r2(k.end_m),
                         recommendedPaceSecPerKm=_r2(k.target_pace_sec_per_km), ratio=round(k.pace_ratio, 4) + 0.0,
                         gradePercent=_r2(k.grade_pct)) for k in plan.km_splits]
        difficulty_ratios = (_segment_difficulty_ratios(plan.segments, distance)
                             if req['mode'] == RunMode.COURSE else [])
        return 200, dict(plannerVersion=PLANNER_VERSION, mode=req['mode'], planStatus='PLANNED',
                         targetDistanceM=_r2(distance), targetPaceSecPerKm=_r2(pace), targetPaceSource=source,
                         goalPreference=req['goal_preference'],
                         recommendedPaceSecPerKm=_r2(plan.expected_avg_pace_sec_per_km), cueBpm=None,
                         routeProgressM=None, predictedFinishSec=int(round(plan.expected_finish_time_s)),
                         segmentDifficultyRatios=difficulty_ratios,
                         segments=segments, hrPreview=_hr_preview(plan, predictor, req['hr0']), warnings=warnings)
    except PlanApiError as e:
        return e.status, e.to_dict()
    except Exception as e:  # noqa: BLE001 - 예상 못 한 계산 실패도 오류 형태로 돌려준다
        return 500, dict(code='PLAN_FAILED', message='사전 계획 계산에 실패했다.', details=dict(reason=type(e).__name__))


def to_db_rows(response: dict) -> dict | None:
    """plan_api 응답 → 저장 행(schema.sql 이름). id·session_id·pace_plan_id·created_at은 backend가 채운다.
    계획이 없으면(무목표) None."""
    if response.get('planStatus') != 'PLANNED':
        return None
    return dict(pace_plans=dict(recommended_pace=response['recommendedPaceSecPerKm'], cue_bpm=response['cueBpm'],
                                route_progress=response['routeProgressM']),
                pace_plan_segments=[dict(segment_sequence=s['segmentSequence'], start_distance=s['startDistanceM'],
                                         end_distance=s['endDistanceM'], recommended_pace=s['recommendedPaceSecPerKm'])
                                    for s in response['segments']])
