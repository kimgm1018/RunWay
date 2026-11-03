"""decide 결과를 스트림·화면에서 쓰는 판단 기록으로 바꾼다."""
from datetime import datetime, timedelta, timezone
from collections.abc import Sequence

FOLLOW_TOL_SEC_PER_KM = 5.0
SOURCE_TOL_SEC = 10.0
MAE_WINDOW_SEC = 600.0
DELIVERY_BY_STAGE = {"L1A": "WATCH", "L1B": "NOT_DELIVERED", "L2": "NOT_DELIVERED", "L2B": "NOT_DELIVERED", "L3": "REPLAY"}


def delivery_for(stage: str) -> str:
    return DELIVERY_BY_STAGE.get(stage, "NOT_DELIVERED")


def _dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _r(value):
    return round(float(value), 2) if value is not None else None


def check_120(current: dict, previous: Sequence[dict]) -> dict:
    now_as_of = _dt(current["inputAsOf"])
    target = now_as_of - timedelta(seconds=120)
    sources = [trace for trace in previous if trace.get("candidates")]
    source = min(sources, key=lambda item: abs((_dt(item["inputAsOf"]) - target).total_seconds()), default=None)
    if source is None or abs((_dt(source["inputAsOf"]) - target).total_seconds()) > SOURCE_TOL_SEC:
        return {"sourceTraceId": None, "actualPaceSecPerKm": None, "recommended": None, "nearest": None,
                "shown": None, "actualHrBpm": current.get("input", {}).get("hrNowBpm"),
                "comparable": False, "notComparableReason": "NO_SOURCE_TRACE"}
    actual_hr = current.get("input", {}).get("hrNowBpm")
    if actual_hr is None:
        return {"sourceTraceId": source.get("traceId"), "actualPaceSecPerKm": None,
                "recommended": None, "nearest": None, "shown": None, "actualHrBpm": None,
                "comparable": False, "notComparableReason": "NO_ACTUAL_HR"}
    dt_sec = (now_as_of - _dt(source["inputAsOf"])).total_seconds()
    start_distance = source.get("input", {}).get("distanceM")
    end_distance = current.get("input", {}).get("distanceM")
    if dt_sec <= 0 or start_distance is None or end_distance is None or end_distance - start_distance <= 0:
        return {"sourceTraceId": source.get("traceId"), "actualPaceSecPerKm": None,
                "recommended": None, "nearest": None, "shown": None, "actualHrBpm": _r(actual_hr),
                "comparable": False, "notComparableReason": "OUT_OF_CANDIDATE_RANGE"}
    actual_pace = 1000.0 * dt_sec / (end_distance - start_distance)
    comparisons = []
    for candidate in source.get("candidates", []):
        pace = candidate.get("paceSecPerKm")
        pred = candidate.get("predHrBpm")
        if pace is None or not pred or len(pred) < 3:
            continue
        gap = abs(actual_pace - pace)
        comparisons.append({"deltaSecPerKm": candidate.get("deltaSecPerKm"),
                            "paceGapSecPerKm": _r(gap), "predHr120Bpm": _r(pred[2]),
                            "errorBpm": _r(actual_hr - pred[2]), "_gap": gap})
    nearest = min(comparisons, key=lambda row: row["_gap"], default=None)
    recommended = None
    chosen = (source.get("decision") or {}).get("chosenIndex")
    if chosen is not None and 0 <= chosen < len(source.get("candidates", [])):
        candidate = source["candidates"][chosen]
        pred = candidate.get("predHrBpm")
        if pred and len(pred) >= 3:
            gap = abs(actual_pace - candidate["paceSecPerKm"])
            recommended = {"deltaSecPerKm": candidate.get("deltaSecPerKm"),
                           "paceGapSecPerKm": _r(gap), "predHr120Bpm": _r(pred[2]),
                           "errorBpm": _r(actual_hr - pred[2]), "_gap": gap}
    if recommended is not None and recommended["_gap"] <= FOLLOW_TOL_SEC_PER_KM:
        shown = "RECOMMENDED"
    elif nearest is not None and nearest["_gap"] <= FOLLOW_TOL_SEC_PER_KM:
        shown = "NEAREST"
    else:
        shown = None
    comparable = shown is not None
    for row in (recommended, nearest):
        if row is not None:
            row.pop("_gap", None)
    return {"sourceTraceId": source.get("traceId"), "actualPaceSecPerKm": _r(actual_pace),
            "recommended": recommended, "nearest": nearest, "shown": shown,
            "actualHrBpm": _r(actual_hr), "comparable": comparable,
            "notComparableReason": None if comparable else "OUT_OF_CANDIDATE_RANGE"}


def mae_10min(current: dict, previous: Sequence[dict]) -> float | None:
    current_time = _dt(current["inputAsOf"])
    records = [*previous, current]
    errors = []
    for trace in records:
        as_of = _dt(trace["inputAsOf"])
        check = trace.get("check120") or {}
        if (current_time - timedelta(seconds=MAE_WINDOW_SEC) <= as_of <= current_time
                and check.get("comparable")):
            shown = check.get("recommended") if check.get("shown") == "RECOMMENDED" else check.get("nearest")
            if shown is None:
                shown = check.get("recommended")
            if shown is not None and shown.get("errorBpm") is not None:
                errors.append(abs(float(shown["errorBpm"])))
    return _r(sum(errors) / len(errors)) if errors else None


def build_trace(outcome, *, boot_id: str, seq: int, stage: str, replay_speed: int | None,
                grade_source: str, previous: Sequence[dict]) -> dict:
    request = outcome.request
    context = request.context
    response = outcome.response
    policy = outcome.policy
    history = request.history
    input_tail = {"hrBpm": [_r(v) for v in history.hr_bpm[-24:]],
                  "speedMps": [_r(v) for v in history.speed_mps[-24:]],
                  "gradePct": [_r(v) for v in history.grade_pct[-24:]]}
    if outcome.pred_hr and policy and response:
        candidate_rows = []
        for i, candidate in enumerate(request.candidates):
            verdict = policy.verdicts[i] if i < len(policy.verdicts) else None
            candidate_rows.append({
                "deltaSecPerKm": int(round(candidate.pace_sec_per_km - context.anchor_pace_sec_per_km)),
                "paceSecPerKm": _r(candidate.pace_sec_per_km),
                "futureSpeedMps": [_r(v) for v in candidate.future_speed_mps],
                "futureGradePct": [_r(v) for v in candidate.future_grade_pct] if candidate.future_grade_pct is not None else None,
                "predHrBpm": [_r(v) for v in outcome.pred_hr[i]],
                "upperHrBpm": [_r(v) for v in verdict.upper_hr_bpm] if verdict else [None, None, None],
                "peakUpperBpm": _r(verdict.peak_upper_bpm) if verdict else None,
                "passed": verdict.passed if verdict else False,
                "rejectReason": verdict.reject_reason if verdict else None,
                "score": _r(verdict.score) if verdict else None,
            })
    else:
        candidate_rows = []
    zero_grade = request.candidates[2].future_grade_pct if len(request.candidates) >= 3 else None
    grade_next = (sum(zero_grade) / len(zero_grade) if zero_grade and all(v is not None for v in zero_grade) else None)
    distance_goal = context.goal.target_distance_m
    remaining = max(0.0, distance_goal - context.distance_m) if distance_goal is not None else None
    hrs = [v for v in history.hr_bpm[-3:] if v is not None]
    speeds = [v for v in history.speed_mps[-12:] if v is not None]
    hr_now = sum(hrs) / len(hrs) if hrs else None
    speed_now = sum(speeds) / len(speeds) if speeds else None
    pace_now = 1000.0 / speed_now if speed_now is not None and speed_now > 0 else None
    trace = {
        "traceId": f"{boot_id}:{seq:06d}", "bootId": boot_id, "sessionId": context.session_id,
        "stage": stage, "replaySpeed": replay_speed if stage == "L3" else None,
        "decidedAt": _iso(outcome.decided_at), "inputAsOf": _iso(context.input_as_of),
        "elapsedSec": _r(request.elapsed_sec), "status": outcome.status,
        "input": {"tail": input_tail,
                  "hrNowBpm": _r(hr_now),
                  "paceNowSecPerKm": _r(pace_now),
                  "distanceM": _r(context.distance_m), "routeProgressM": _r(context.route_progress_m),
                  "remainingM": _r(remaining), "gradeNext120sPct": _r(grade_next), "gradeSource": grade_source},
        "reference": ({"hrDangerBpm": _r(policy.hr_danger_bpm), "hrSustainBpm": _r(policy.hr_sustain_bpm),
                       "allowBpm": _r(policy.allow_bpm), "hardEffBpm": _r(policy.hard_eff_bpm),
                       "source": policy.hr_threshold_source, "weight": _r(policy.hr_threshold_weight)}
                      if policy else None),
        "marginTableVersion": policy.margin_table_version if policy else None,
        "gate": response.gate if response else None,
        "anchorPaceSecPerKm": _r(context.anchor_pace_sec_per_km),
        "candidates": candidate_rows,
        "decision": response.decision.model_dump(by_alias=True, mode="json") if response and response.decision else None,
        "latency": {"inputLagMs": None if stage == "L3" else round((outcome.received_at - context.input_as_of).total_seconds() * 1000),
                    "decideMs": _r(outcome.decide_ms), "modelMs": _r(outcome.model_ms)},
        "modelVersion": response.model_version if response else None,
        "policyVersion": response.policy_version if response else None,
        "stateVersion": context.state_version,
        "coaching": {"publishSuggested": response.publish_suggested if response else False,
                     "delivery": delivery_for(stage),
                     "lastCoachingId": context.last_coaching.coaching_id if context.last_coaching else None,
                     "lastAppliedAt": _iso(context.last_coaching.applied_at) if context.last_coaching else None},
        "check120": None, "mae10MinBpm": None,
    }
    if outcome.status in {"INPUT_INSUFFICIENT", "PAUSED"}:
        trace["reference"] = None
        trace["gate"] = None
        trace["decision"] = None
        trace["candidates"] = []
    trace["check120"] = check_120(trace, previous)
    trace["mae10MinBpm"] = mae_10min(trace, previous)
    return trace
