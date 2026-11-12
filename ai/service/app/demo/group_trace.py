"""AI10 그룹 공동 페이스 결과를 시연 화면용 판단 기록으로 바꾼다."""
from datetime import datetime, timezone

from app.decide.service import recent_inputs
from app.demo.trace import delivery_for

HORIZONS_SEC = (30, 60, 120)

# AI10 응답(direction, reason)을 화면 이유 코드로 바꾼다
REASON_TEXT = {
    "SPEED_UP": "가속",
    "AHEAD": "여유 가속",
    "SLOW_DOWN": "감속",
    "HOLD": "정상 · 유지",
    "COOLDOWN": "유지 · 변경 후 2분",
    "WARMUP": "감속 · 출발 3분 제한",
}


def reason_code(direction: str, reason: str) -> str:
    if direction == "FAST":
        return "AHEAD" if reason == "AHEAD" else "SPEED_UP"
    if direction == "SLOW":
        return "WARMUP" if reason == "WARMUP_CAP" else "SLOW_DOWN"
    return "COOLDOWN" if reason == "COOLDOWN" else "HOLD"


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _r(value):
    return round(float(value), 2) if value is not None else None


def _pace(sec: float) -> str:
    value = max(0, round(float(sec)))
    return f"{value // 60}'{value % 60:02d}\""


def _reason_text(code: str, response, frm: float, to: float, worst: dict | None, ahead: dict | None = None) -> str:
    if code == "AHEAD":
        margin = round(ahead["marginBpm"]) if ahead else 15
        demo = f" · 시연 설정 · 대기 {round(ahead['waitSec'])}초" if ahead and ahead.get("demoWait") else ""
        return f"모두 허용선보다 {margin} bpm 이상 여유 → 출발보다 빠르게 {_pace(frm)}에서 {_pace(to)}로 여유 가속{demo}"
    if code == "SPEED_UP":
        return f"모두 허용선 아래로 여유 → {_pace(frm)}에서 {_pace(to)}로 가속"
    if code in ("SLOW_DOWN", "WARMUP"):
        who = ""
        if worst is not None and worst.get("baselineUpperBpm") is not None:
            who = f"{worst['label']} 상한 {round(worst['baselineUpperBpm'])} ≥ 허용 {round(worst['allowBpm'])} → "
        tail = " (출발 3분 안이라 +10초까지)" if code == "WARMUP" else ""
        floor = " · 가장 느린 후보" if response.reason == "FLOOR" else ""
        return f"{who}{_pace(frm)}에서 {_pace(to)}로 감속{tail}{floor}"
    if code == "COOLDOWN":
        return f"페이스를 바꾼 지 2분이 안 되어 {_pace(frm)} 유지"
    if response.reason == "NO_DATA":
        return f"심박 데이터가 부족해 {_pace(frm)} 유지"
    return f"모두 허용선 아래 · {_pace(frm)} 유지"


def build_group_trace(body, response, detail: dict, *, boot_id: str, seq: int, stage: str, label: str,
                      policy_version: str, decided_at: datetime, decide_ms: float | None) -> dict:
    paces = detail.get("paces") or [body.current_group_pace_sec_per_km]
    baseline = detail.get("baseline", 0)
    chosen = detail.get("chosen", baseline)
    current = float(body.current_group_pace_sec_per_km)
    order = {id(p.history): i for i, p in enumerate(body.participants)}
    members = []
    for item in detail.get("members", []):
        history = item["history"]
        hr_now, _, pace_now = recent_inputs(history)
        allow = item["allow"]
        upper = item["upper"] or [None] * len(paces)
        pred = item["pred"] or [[None] * 3] * len(paces)
        index = order.get(id(history), len(members))
        members.append({
            "_order": index, "label": f"러너 {index + 1}",
            "hrNowBpm": _r(hr_now), "paceNowSecPerKm": _r(pace_now),
            "allowBpm": _r(allow), "dangerBpm": _r(item.get("danger")),
            "predHrBpm": [[_r(v) for v in row] for row in pred],          # 후보별 30·60·120초
            "predHr120Bpm": [_r(row[2]) if row and row[2] is not None else None for row in pred],
            "upperHrBpm": [_r(v) for v in upper],                          # 후보별 120초 예측 + 여유
            "passed": [u is not None and u < allow for u in upper],
            "headroomBpm": _r(allow - upper[chosen]) if upper[chosen] is not None else None,
            "baselineUpperBpm": _r(upper[baseline]) if upper[baseline] is not None else None,
            "hrTail": [_r(v) for v in history.hr_bpm[-24:]],
        })
        if "gruGb" in item:   # 641: 기능이 켜져 있을 때만
            members[-1]["gruGb"] = item["gruGb"]
        if "readiness" in item:   # 676: 기능이 켜져 있을 때만(오늘 준비도·허용 심박 감소·개인 c 비중)
            members[-1]["readiness"] = item["readiness"]
    members.sort(key=lambda m: m["_order"])
    for m in members:
        m.pop("_order")
    worst_index = None
    if members:
        scored = [(m["headroomBpm"], i) for i, m in enumerate(members) if m["headroomBpm"] is not None]
        worst_index = min(scored)[1] if scored else None
    worst = members[worst_index] if worst_index is not None else None
    candidates = [{"deltaSecPerKm": int(round(p - current)), "paceSecPerKm": _r(p),
                   "passed": all(m["passed"][j] for m in members) if members else None}
                  for j, p in enumerate(paces)]
    to = float(response.group_pace_sec_per_km)
    code = reason_code(response.direction, response.reason)
    as_of = body.now
    return {
        "traceId": f"{boot_id}:{seq:06d}", "bootId": boot_id, "kind": "GROUP",
        "groupRunId": body.group_run_id, "sessionId": None,
        "stage": stage, "replaySpeed": None,
        "decidedAt": _iso(decided_at), "inputAsOf": _iso(as_of),
        "elapsedSec": _r(body.elapsed_sec), "status": "OK" if response.reason != "NO_DATA" else "INPUT_INSUFFICIENT",
        "input": {"hrNowBpm": worst["hrNowBpm"] if worst else None, "paceNowSecPerKm": _r(current),
                  "distanceM": None, "routeProgressM": None, "remainingM": None, "gradeNext120sPct": None},
        "reference": {"allowBpm": worst["allowBpm"]} if worst else None,
        "candidates": [],
        "decision": {"action": "GUIDE_PACE", "chosenIndex": chosen,
                     "fromPaceSecPerKm": _r(current), "recommendedPaceSecPerKm": _r(to),
                     "changed": response.changed, "direction": response.direction,
                     "reason": response.reason, "reasonCode": code, "reasonLabel": REASON_TEXT[code],
                     "reasonText": _reason_text(code, response, current, to, worst, detail.get("ahead"))},
        "group": {"label": "그룹 공동 페이스 · AI10", "runLabel": label,
                  "goalPaceSecPerKm": _r(body.goal_pace_sec_per_km),
                  "progressRatio": _r(body.progress_ratio),
                  "candidates": candidates, "chosenIndex": chosen, "baselineIndex": baseline,
                  "members": members, "worstIndex": worst_index,
                  "strugglingCount": response.struggling_count, "excludedCount": response.excluded_count,
                  "paceOnlyCount": response.pace_only_count, "warnings": list(response.warnings),
                  "horizonsSec": list(HORIZONS_SEC),
                  # S15P31E105-728 여유 가속 판단(꺼져 있으면 None): applied, blockedBy, waitSec, demoWait, marginBpm,
                  # steadySec, startPace, fastestPace
                  "ahead": detail.get("ahead")},
        "latency": {"inputLagMs": None, "decideMs": _r(decide_ms), "modelMs": None},
        "modelVersion": response.model_version, "policyVersion": policy_version,
        "coaching": {"publishSuggested": response.changed, "delivery": delivery_for(stage),
                     "lastCoachingId": None, "lastAppliedAt": None},
        "check120": None, "mae10MinBpm": None,
    }
