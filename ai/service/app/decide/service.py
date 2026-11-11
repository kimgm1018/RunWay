"""요청 신선도, 예측, 정책, API 응답을 한 번의 판단으로 묶는다."""
import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from app.pace_selector import DELTAS
from app.decide.policy_port import PacePolicy, PolicyCandidate, PolicyInput, PolicyOutput
from app.decide.schemas import CandidateResult, DecideRequest, DecideResponse, Decision, Pacing
from app.inference import ApiError, check_sufficient, free_run_warnings, to_batch
from app.models.base import HRModel
from app.gru_personalization import GruPersonalizationResult, UNAVAILABLE_WARNING, lookup_user_personalization
from app.ai_logging import log_ai_error
from app.hr_threshold_lookup import HrThresholdLookupResult, UNAVAILABLE_WARNING as HR_THRESHOLD_UNAVAILABLE_WARNING
from app.policy.config import load_policy_config
from app.policy.hr_reference import HrThresholds, blend_hr_thresholds
from app.policy.mpc_policy import ease_off_pace, handover_phase, plan_pace, progress
from app.bpm_cue import CUE_BPM_UNAVAILABLE


SLOW_STEPS_SEC_PER_KM = tuple(d for d in DELTAS if d > 0)


@dataclass(frozen=True)
class DecideOutcome:
    request: DecideRequest
    status: str
    response: DecideResponse | None
    policy: PolicyOutput | None
    pred_hr: tuple[tuple[float, float, float], ...] | None
    received_at: datetime
    decided_at: datetime
    decide_ms: float
    model_ms: float | None
    error: ApiError | None


def recent_inputs(history) -> tuple[float | None, float | None, float | None]:
    """최근 HR 세 칸과 속도 열두 칸의 결측 제외 평균을 계산한다."""
    hrs = [v for v in history.hr_bpm[-3:] if v is not None]
    speeds = [v for v in history.speed_mps[-12:] if v is not None]
    hr_now = sum(hrs) / len(hrs) if hrs else None
    speed_now = sum(speeds) / len(speeds) if speeds else None
    pace_now = 1000.0 / speed_now if speed_now is not None and speed_now > 0 else None
    return hr_now, speed_now, pace_now


def _anchor_index(body: DecideRequest) -> int:
    """안내(기준 페이스) 그대로인 후보의 위치. 후보는 기준 + DELTAS(−30 … +60) 순서라 보통 3이다."""
    anchor = body.context.anchor_pace_sec_per_km
    return min(range(len(body.candidates)), key=lambda i: abs(body.candidates[i].pace_sec_per_km - anchor))


def _speed_rows(batch: dict, speeds: list[float], anchor_index: int, *, keep: bool) -> dict:
    """안내 그대로 후보를 복사해 미래 속도만 바꾼 행들을 만든다(S15P31E105-504, -506).

    과거 심박·속도·경사, 경과 시간, 미래 경사는 그 후보와 같다. 실측 속도 행은 "러너가 지금 속도로 2분 계속
    달리면"(코칭 단계), 느린·빠른 페이스 행은 "이만큼 늦추면/올리면"(넘친 만큼)의 심박을 예측한다.
    keep=True면 원래 배치 끝에 덧붙이고, False면 만든 행만 돌려준다.
    """
    if not speeds:
        return batch
    out = {}
    for key, value in batch.items():
        if value is None:
            out[key] = None
            continue
        rows = np.repeat(np.array(value[anchor_index:anchor_index + 1], copy=True), len(speeds), axis=0)
        if key == "future_speed":
            rows[:] = np.asarray(speeds, dtype=rows.dtype)[:, None]
        out[key] = np.concatenate([value, rows], axis=0) if keep else rows
    return out



def _outcome(body, status, response, policy, pred_hr, received_at, decided_at, begin, model_ms, error):
    return DecideOutcome(body, status, response, policy, pred_hr, received_at, decided_at,
                         (time.perf_counter() - begin) * 1000.0, model_ms, error)

def _bpm_input(body: DecideRequest, bpm_lookup) -> tuple[object | None, tuple[str, ...]]:
    """BPM 계산에 쓸 사용자 기록. context.bpm(시험·시연용)이 오면 그대로 쓰고, 없으면 DB에서 읽는다."""
    if body.context.bpm is not None or bpm_lookup is None:
        return body.context.bpm, ()
    result = bpm_lookup.get_for_session(body.context.session_id)
    return result.bpm_input, ((result.warning,) if result.warning else ())


def _cue_bpm(calc, pace: float, body: DecideRequest, bpm_lookup=None) -> tuple[int | None, tuple[str, ...]]:
    """추천 페이스의 목표 BPM. 계산기를 안 넣었으면(기능 꺼짐) null, 계산이 실패하면 null + 경고.
    기록을 못 읽으면 평균 BPM을 주고 경고만 붙인다."""
    if calc is None:
        return None, ()
    bpm_input, warnings = _bpm_input(body, bpm_lookup)
    try:
        return calc.compute(pace, bpm_input), warnings
    except Exception as exc:
        log_ai_error(CUE_BPM_UNAVAILABLE, "/v1/pace/decide", exc, level=logging.WARNING)
        return None, warnings + (CUE_BPM_UNAVAILABLE,)

def _thresholds_for_user(user_id, lookup, cfg, *, configured: bool = True) -> tuple[HrThresholds, tuple[str, ...]]:
    if user_id is None:
        return blend_hr_thresholds(cfg), ()
    if lookup is None:
        # configured=False: 설정상 DB가 없다(AI_DB_URL 없음). 조용히 모집단 기준을 쓴다(시작 로그는 main에서 한 번).
        # configured=True인데 조회기가 없으면 DB 연결 실패이므로 경고를 붙인다.
        if not configured:
            return blend_hr_thresholds(cfg), ()
        return blend_hr_thresholds(cfg), (HR_THRESHOLD_UNAVAILABLE_WARNING,)
    try:
        result = lookup.get_for_user(user_id)
    except Exception as exc:
        log_ai_error(HR_THRESHOLD_UNAVAILABLE_WARNING, "/v1/pace/decide", exc, level=logging.WARNING)
        return blend_hr_thresholds(cfg), (HR_THRESHOLD_UNAVAILABLE_WARNING,)
    if not isinstance(result, HrThresholdLookupResult):
        return blend_hr_thresholds(cfg), (HR_THRESHOLD_UNAVAILABLE_WARNING,)
    if result.warning:
        return blend_hr_thresholds(cfg), (result.warning,)
    return blend_hr_thresholds(
        cfg,
        personal_danger_bpm=result.hr_danger_bpm,
        personal_sustain_bpm=result.hr_sustain_bpm,
        run_count=result.hr_threshold_run_count,
    ), ()


def _too_short_plan_hold(body: DecideRequest, *, thresholds: HrThresholds, cfg, received_at: datetime,
                         decided_at: datetime, begin: float, threshold_warnings: tuple[str, ...],
                         extra_warnings: tuple[str, ...], model_version: str,
                         policy_version: str, cue_bpm_calc=None, bpm_lookup=None) -> DecideOutcome:
    ctx = body.context
    hr_now = body.history.hr_bpm[-1]
    _, speed_now, pace_now = recent_inputs(body.history)
    phase, weight = handover_phase(ctx.active_sec, cfg)
    prog = progress(ctx, pace_now, cfg)
    guide = ctx.current_guide_pace_sec_per_km
    safety = hr_now is not None and hr_now >= thresholds.danger_bpm
    if safety:
        recommended = ease_off_pace(ctx, pace_now, cfg)
        action, status, reason = "EASE_OFF", "SAFETY", "SAFETY"
        reason_text = f"실측 심박 {round(hr_now)}가 위험 기준 {round(thresholds.danger_bpm)} 이상입니다. 페이스를 늦춰 주세요."
        gate = "SAFETY"
    else:
        recommended = plan_pace(ctx, prog)
        action, status, reason = "GUIDE_PACE", "OK", "PLAN_HOLD"
        reason_text = "기록이 한 칸뿐이라 예측을 건너뛰고 계획 페이스를 안내합니다."
        gate = None
    cue, cue_warnings = _cue_bpm(cue_bpm_calc, recommended, body, bpm_lookup)
    decision = Decision(
        action=action, chosen_index=None, recommended_pace_sec_per_km=recommended, cue_bpm=cue,
        predicted_hr_30_bpm=None, predicted_hr_60_bpm=None, predicted_hr_120_bpm=None,
        route_progress_m=ctx.route_progress_m, based_on_state_version=ctx.state_version,
        expires_at=min(decided_at, ctx.input_as_of) + timedelta(seconds=20),
        reason=reason, reason_text=reason_text,
        # 한 칸 경로는 예측이 없어 실측 심박으로만 나눈다(S15P31E105-504).
        coaching_level="DANGER" if safety else "OK",
    )
    actual_minus = pace_now - guide if pace_now is not None and guide is not None else None
    response = DecideResponse(
        trace_id=None, model_version=model_version, policy_version=policy_version, status=status, gate=gate,
        publish_suggested=guide is None or abs(recommended - guide) >= cfg.publish_delta_sec_per_km,
        decision=decision, candidates=[],
        pacing=Pacing(actual_minus_guide_sec_per_km=actual_minus,
                      eta_sec=prog.eta_sec, eta_minus_goal_sec=prog.eta_minus_goal_sec,
                      handover_phase=phase, plan_weight=weight,
                      hr_danger_bpm=thresholds.danger_bpm, hr_sustain_bpm=thresholds.sustain_bpm,
                      hr_threshold_source=thresholds.source, hr_threshold_weight=thresholds.weight),
        warnings=["HISTORY_TOO_SHORT_PLAN_HOLD", *extra_warnings, *threshold_warnings, *cue_warnings],
        hr_personalized=False if body.user_id is not None else None,
    )
    return _outcome(body, status, response, None, None, received_at, decided_at, begin, None, None)


def run_decide(body: DecideRequest, model: HRModel, policy: PacePolicy, *, received_at: datetime,
               now: Callable[[], datetime], free_run_grade_policy: str = "reject",
               user_personalization_lookup=None, hr_threshold_lookup=None,
               gru_personalization_enabled: bool = True,
               hr_threshold_lookup_configured: bool = True, cue_bpm_calc=None, bpm_lookup=None) -> DecideOutcome:
    """신선도 검사부터 정책 응답까지 수행한다.

    gru_personalization_enabled=False면 userId가 있어도 개인화 조회·경고·로그를 하지 않는다.
    hr_threshold_lookup_configured=False면 기준 조회기가 없어도 경고 없이 모집단 기준을 쓴다.
    기본값 True는 이전 동작(조회기 None = 사용 불가 경고)을 그대로 유지한다.
    """
    begin = time.perf_counter()
    compatibility_warnings = (("HR_REFERENCE_INPUT_IGNORED",)
                              if body.context.hr_reference is not None else ())
    if body.context.run_state == "PAUSED":
        at = now()
        response = DecideResponse(trace_id=None, model_version=model.info.model_version,
                                  policy_version=policy.policy_version, status="PAUSED", gate=None,
                                  publish_suggested=False, decision=None, candidates=[], pacing=None,
                                  warnings=list(compatibility_warnings),
                                  hr_personalized=False if body.user_id is not None else None)
        return _outcome(body, "PAUSED", response, None, None, received_at, at, begin, None, None)

    age = (received_at - body.context.input_as_of).total_seconds()
    if age >= policy.input_insufficient_sec:
        at = now()
        error = ApiError(422, "INPUT_INSUFFICIENT", "입력이 20초 이상 오래되었습니다.",
                         [{"name": "context.inputAsOf", "reason": "입력 기준시각이 20초를 넘었습니다"}])
        response = DecideResponse(trace_id=None, model_version=model.info.model_version,
                                  policy_version=policy.policy_version, status="INPUT_INSUFFICIENT", gate=None,
                                  publish_suggested=False, decision=None, candidates=[], pacing=None,
                                  warnings=list(compatibility_warnings),
                                  hr_personalized=False if body.user_id is not None else None)
        return _outcome(body, "INPUT_INSUFFICIENT", response, None, None, received_at, at, begin, None, error)
    cfg = getattr(policy, "cfg", None) or load_policy_config()
    if (body.context.plan and body.context.active_sec < cfg.plan_hold_sec
            and len(body.history.hr_bpm) == 1):
        thresholds, threshold_warnings = _thresholds_for_user(body.user_id, hr_threshold_lookup, cfg,
                                                              configured=hr_threshold_lookup_configured)
        at = now()
        # 1칸 PLAN_HOLD는 GRU 예측을 하지 않아 과거·미래 경사를 채우지 않는다. 그래서 자유러닝 경고를 붙이지 않는다.
        # (일반 경로의 자유러닝 판정 is_free_run은 팀 계약이라 바꾸지 않는다.)
        extra_warnings = compatibility_warnings
        return _too_short_plan_hold(
            body, thresholds=thresholds, cfg=cfg, received_at=received_at, decided_at=at, begin=begin,
            threshold_warnings=threshold_warnings, extra_warnings=extra_warnings,
            model_version=model.info.model_version, policy_version=policy.policy_version, cue_bpm_calc=cue_bpm_calc, bpm_lookup=bpm_lookup,
        )

    try:
        check_sufficient(body, model.info.min_samples, free_run_grade_policy)
    except ApiError as error:
        at = now()
        response = DecideResponse(trace_id=None, model_version=model.info.model_version,
                                  policy_version=policy.policy_version, status="INPUT_INSUFFICIENT", gate=None,
                                  publish_suggested=False, decision=None, candidates=[], pacing=None,
                                  warnings=list(compatibility_warnings),
                                  hr_personalized=False if body.user_id is not None else None)
        return _outcome(body, "INPUT_INSUFFICIENT", response, None, None, received_at, at, begin, None, error)

    thresholds, threshold_warnings = _thresholds_for_user(body.user_id, hr_threshold_lookup, cfg,
                                                          configured=hr_threshold_lookup_configured)

    hr_now, speed_now, pace_now = recent_inputs(body.history)
    # 걷기·정지는 HR 기준 경고를 유지하고 GRU 개인화 조회·예측과 정책 판단을 건너뛴다.
    if speed_now is None or speed_now < cfg.walk_speed_mps:
        at = now()
        response = DecideResponse(
            trace_id=None, model_version=model.info.model_version, policy_version=policy.policy_version,
            status="NOT_RUNNING", gate=None, publish_suggested=False, decision=None, candidates=[],
            pacing=Pacing(),
            warnings=free_run_warnings(body, free_run_grade_policy)
            + list(threshold_warnings) + list(compatibility_warnings),
            hr_personalized=False if body.user_id is not None else None,
            hr_personalization_version=None,
        )
        return _outcome(body, "NOT_RUNNING", response, None, None, received_at, at, begin, None, None)

    # 코칭 단계용: 러너가 실측 속도로 2분 달리는 행을 하나 덧붙여 같은 GRU 호출로 함께 예측한다(S15P31E105-504).
    # 요청 후보는 그대로다. 걷기·정지는 위에서 NOT_RUNNING으로 끝내므로 이 경로에 오지 않는다.
    actual_speed = (speed_now if getattr(cfg, "actual_pace_check_enabled", False) and speed_now is not None
                    and speed_now >= cfg.walk_speed_mps else None)
    # 감속 기준(S15P31E105-624 수정 1): 러너가 안내보다 느리면 max(안내, 실측) + 폭으로 늦춰야 실제로 느려진다.
    # 그 페이스들을 안내 그대로 후보를 복사한 행으로 같은 GRU 호출에 덧붙인다(두 번째 호출 없음).
    anchor_pace = body.context.anchor_pace_sec_per_km
    slow_paces = ([pace_now + d for d in SLOW_STEPS_SEC_PER_KM]
                  if pace_now is not None and pace_now > anchor_pace + 0.5 else [])
    extra_speeds = ([actual_speed] if actual_speed is not None else []) + [1000.0 / q for q in slow_paces]
    n_rows = len(body.candidates) + len(extra_speeds)

    def model_batch() -> dict:
        batch = to_batch(body, free_run_grade_policy)
        return _speed_rows(batch, extra_speeds, _anchor_index(body), keep=True) if extra_speeds else batch

    model_start = time.perf_counter()
    personalization_warning = None
    personalization_version = None
    personalized = False
    prediction = None
    # 개인화가 설정상 꺼져 있으면 조회·경고·로그 없이 기본 GRU로 예측한다(hrPersonalized=false는 유지).
    if body.user_id is not None and gru_personalization_enabled:
        if user_personalization_lookup is None:
            log_ai_error(UNAVAILABLE_WARNING, "/v1/pace/decide", Warning(),
                         level=logging.WARNING)
            personalization = GruPersonalizationResult(warning=UNAVAILABLE_WARNING)
        else:
            personalization = lookup_user_personalization(
                user_personalization_lookup, body.user_id, model, endpoint="/v1/pace/decide")
        personalization_warning = personalization.warning
        personalization_version = personalization.personalization_version
        if personalization.state is not None:
            predict_with_state = getattr(model, "predict_with_state", None)
            if callable(predict_with_state):
                try:
                    candidate_prediction = np.asarray(
                        predict_with_state(model_batch(), personalization.state), dtype=float)
                    if (candidate_prediction.shape != (n_rows, 3)
                            or not np.isfinite(candidate_prediction).all()):
                        raise ValueError("GRU 개인화 출력이 올바르지 않습니다.")
                    prediction = candidate_prediction
                    personalized = True
                except Exception as exc:
                    # 사용자 출력층을 적용하지 못해도 러닝 안전 판단은 기본 GRU로 계속한다.
                    log_ai_error("GRU_PERSONALIZATION_UNAVAILABLE", "/v1/pace/decide", exc,
                                 level=logging.WARNING)
                    personalization_warning = UNAVAILABLE_WARNING
                    personalization_version = None
            else:
                log_ai_error(UNAVAILABLE_WARNING, "/v1/pace/decide", Warning(),
                             level=logging.WARNING)
                personalization_warning = UNAVAILABLE_WARNING
    try:
        if prediction is None:
            prediction = np.asarray(model.predict(model_batch()), dtype=float)
    except Exception:
        raise ApiError(500, "PREDICTION_FAILED", "모델 출력이 올바르지 않습니다.") from None
    model_ms = (time.perf_counter() - model_start) * 1000.0
    if prediction.shape != (n_rows, 3) or not np.isfinite(prediction).all():
        raise ApiError(500, "PREDICTION_FAILED", "모델 출력이 올바르지 않습니다.")
    pred_hr = tuple(tuple(float(v) for v in row) for row in prediction[:len(body.candidates)])
    actual_pred = (tuple(float(v) for v in prediction[len(body.candidates)])
                   if actual_speed is not None else None)
    slow_start = len(body.candidates) + (1 if actual_speed is not None else 0)
    slow_grade = body.candidates[_anchor_index(body)].future_grade_pct
    slow_rows = tuple(
        PolicyCandidate(delta_sec_per_km=int(round(q - anchor_pace)), pace_sec_per_km=q, future_speed_mps=1000.0 / q,
                        pred_hr_bpm=tuple(float(v) for v in prediction[slow_start + j]),
                        future_grade_pct=tuple(slow_grade) if slow_grade is not None else None)
        for j, q in enumerate(slow_paces))
    decided_at = now()
    recent_cells = tuple(zip(body.history.hr_bpm[-12:], body.history.speed_mps[-12:]))
    candidates = tuple(
        PolicyCandidate(
            delta_sec_per_km=int(round(c.pace_sec_per_km - body.context.anchor_pace_sec_per_km)),
            pace_sec_per_km=c.pace_sec_per_km,
            future_speed_mps=c.future_speed_mps[0],
            pred_hr_bpm=pred_hr[i],
            future_grade_pct=tuple(c.future_grade_pct) if c.future_grade_pct is not None else None,
        ) for i, c in enumerate(body.candidates)
    )
    policy_input = PolicyInput(decided_at, age, hr_now, speed_now, pace_now, recent_cells, body.context,
                               candidates, thresholds, actual_pred_hr_bpm=actual_pred, slow_rows=slow_rows)
    try:
        output = policy.decide(policy_input)
    except Exception as exc:
        raise ApiError(500, "DECISION_FAILED", "판단 중 오류가 발생했습니다.") from None

    results = []
    for i, candidate in enumerate(body.candidates):
        verdict = output.verdicts[i] if i < len(output.verdicts) else None
        results.append(CandidateResult(
            pace_sec_per_km=candidate.pace_sec_per_km,
            pred_hr_bpm=list(pred_hr[i]),
            upper_hr_bpm=list(verdict.upper_hr_bpm) if verdict else [None, None, None],
            passed=verdict.passed if verdict else False,
            reject_reason=verdict.reject_reason if verdict else None,
            score=verdict.score if verdict else None,
        ))
    decision = None
    cue_warnings: tuple[str, ...] = ()
    if output.action in {"GUIDE_PACE", "EASE_OFF"} and output.recommended_pace_sec_per_km is not None:
        chosen = output.chosen_index
        chosen_pred = (pred_hr[chosen] if chosen is not None and 0 <= chosen < len(pred_hr)
                       else getattr(output, "chosen_pred_hr_bpm", None) or (None, None, None))
        expires = min(decided_at, body.context.input_as_of) + timedelta(seconds=20)
        cue, cue_warnings = _cue_bpm(cue_bpm_calc, output.recommended_pace_sec_per_km, body, bpm_lookup)
        decision = Decision(
            action=output.action, chosen_index=chosen,
            recommended_pace_sec_per_km=output.recommended_pace_sec_per_km,
            cue_bpm=cue, predicted_hr_30_bpm=chosen_pred[0], predicted_hr_60_bpm=chosen_pred[1],
            predicted_hr_120_bpm=chosen_pred[2], route_progress_m=body.context.route_progress_m,
            based_on_state_version=body.context.state_version, expires_at=expires,
            reason=output.reason, reason_text=output.reason_text,
            coaching_level=getattr(output, "coaching_level", None),
        )
    response = DecideResponse(
        trace_id=None, model_version=model.info.model_version, policy_version=policy.policy_version,
        status=output.status, gate=output.gate, publish_suggested=output.publish_suggested,
        decision=decision, candidates=results,
        pacing=Pacing(actual_minus_guide_sec_per_km=output.actual_minus_guide_sec_per_km,
                      eta_sec=output.eta_sec, eta_minus_goal_sec=output.eta_minus_goal_sec,
                      handover_phase=output.handover_phase, plan_weight=output.plan_weight,
                      hr_danger_bpm=output.hr_danger_bpm, hr_sustain_bpm=output.hr_sustain_bpm,
                      hr_threshold_source=output.hr_threshold_source,
                      hr_threshold_weight=output.hr_threshold_weight),
        warnings=list(output.warnings) + free_run_warnings(body, free_run_grade_policy)
        + list(threshold_warnings) + list(compatibility_warnings)
        + ([personalization_warning] if personalization_warning else []) + list(cue_warnings),
        hr_personalized=personalized if body.user_id is not None else None,
        hr_personalization_version=personalization_version if personalized else None,
    )
    return _outcome(body, output.status, response, output, pred_hr, received_at, decided_at,
                    begin, model_ms, None)
