"""테스트에서만 쓰는 예측기·정책과 합성 입력 도우미."""
import asyncio
import copy
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from app.decide.policy_port import CandidateVerdict, PolicyOutput, PolicyInput, PolicyCandidate
from app.decide.schemas import DecideContext, DecideRequest, HrReferenceInput
from app.models.base import ModelInfo
from app.policy.residual_margin import MarginTable, DIRECTIONS, GRADES, HORIZONS

T0 = datetime(2026, 11, 5, 5, 16, 35, tzinfo=timezone.utc)
T = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)
DELTAS = (-10, -5, 0, 5, 10)


def decide_body(**context_overrides):
    context = {
        "sessionId": 201, "stateVersion": 7, "runState": "RUNNING", "mode": "COURSE",
        "goal": {"targetDistanceM": 5000, "targetDurationSec": 1800, "targetPaceSecPerKm": None},
        "goalPreference": 0.5, "plan": None, "anchorPaceSecPerKm": 340,
        "currentGuidePaceSecPerKm": 340, "guidePaceSetAt": "2026-11-05T05:14:35Z",
        "activeSec": 995, "distanceM": 2310.0, "routeProgressM": 2310.0,
        "inputAsOf": "2026-11-05T05:16:35Z",
        "lastCoaching": None, "resumedAt": None,
    }
    history = {"hrBpm": [150.0] * 80, "speedMps": [3.0] * 80, "gradePct": [0.0] * 80}
    if "history" in context_overrides:
        history.update(context_overrides.pop("history"))
    context.update(context_overrides)
    anchor = context["anchorPaceSecPerKm"]
    candidates = [{"paceSecPerKm": anchor + d, "futureSpeedMps": [1000.0 / (anchor + d)] * 24,
                   "futureGradePct": [0.0] * 24} for d in DELTAS]
    return {"elapsedSec": 995.0, "history": history, "candidates": candidates, "context": context}


class FakeModel5:
    """마지막 HR과 미래 속도로 세 예측점을 만드는 가짜 모델."""
    info = ModelInfo(model_type="fake", model_version="fake-1", window_sec=360, min_samples=1)

    def __init__(self):
        self.batches = []

    def predict(self, batch):
        self.batches.append(batch)
        hr = batch["hr"][:, -1]
        speed_change = batch["future_speed"].mean(axis=1) - 3.0
        return hr[:, None] + speed_change[:, None] * np.array([2.0, 4.0, 8.0])


class FakePolicy:
    """요청을 저장하고 단순한 안전·유지 결과를 돌려주는 정책."""
    policy_version = "fake-policy-1"
    input_insufficient_sec = 20.0

    def __init__(self, raise_error=False, publish=True):
        self.raise_error = raise_error
        self.publish = publish
        self.calls = []

    def decide(self, inp: PolicyInput) -> PolicyOutput:
        self.calls.append(inp)
        if self.raise_error:
            raise RuntimeError("가짜 정책 오류")
        safe = inp.hr_now_bpm is not None and inp.hr_now_bpm >= 185
        verdicts = tuple(CandidateVerdict(tuple(v + 2 for v in c.pred_hr_bpm), max(c.pred_hr_bpm) + 2,
                                           max(c.pred_hr_bpm) + 2 < 175, None, None) for c in inp.candidates)
        if safe:
            pace = (inp.pace_now_sec_per_km or inp.context.anchor_pace_sec_per_km) + 30
            # 가짜 정책도 새 학습 기준 응답 필드를 실제 모집단 기본값과 맞춘다.
            return PolicyOutput("SAFETY", "EASE_OFF", None, pace, "SAFETY", "가짜 안전 안내", None,
                                verdicts, True, allow_bpm=163.0, hard_eff_bpm=175.0,
                                hr_danger_bpm=175.0, hr_sustain_bpm=163.0,
                                hr_threshold_source="POPULATION", hr_threshold_weight=0.0,
                                margin_table_version="fake-margin-1")
        status = "HR_STALE" if inp.input_age_sec > 15 else "OK"
        return PolicyOutput(status, "GUIDE_PACE", 2, inp.candidates[2].pace_sec_per_km,
                            "HOLD", "현재 pace 유지", "ALL", verdicts, self.publish,
                            allow_bpm=163.0, hard_eff_bpm=175.0,
                            hr_danger_bpm=175.0, hr_sustain_bpm=163.0,
                            hr_threshold_source="POPULATION", hr_threshold_weight=0.0,
                            margin_table_version="fake-margin-1")


def fixed_clock(sec_after_T0=0.0):
    return lambda: T0 + timedelta(seconds=sec_after_T0)


def flat_table(m=4.0, cells=None):
    values = {(h, d, g): float(m) for h in HORIZONS for d in DIRECTIONS for g in GRADES}
    values.update(cells or {})
    return MarginTable("test-flat", "GRU", "OFF", "P90", values)


def write_margin_table(tmp_path, model="GRU", m=4.0):
    margins = {str(h): {d: {g: float(m) for g in GRADES} for d in DIRECTIONS} for h in HORIZONS}
    obj = {"version": "test-flat", "model": model, "personalization": "OFF", "set": "W1", "quantile": "P90",
           "source": {"file": "test.csv", "sha256": "0" * 64},
           "direction": {"variable": "synthetic", "accelAtLeastMps": 0.15, "decelAtMostMps": -0.15},
           "grade": {"variable": "synthetic", "upAbovePct": 2.0, "downBelowPct": -2.0},
           "marginsBpm": margins, "fallbackCells": []}
    path = Path(tmp_path) / "margin.json"
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


def policy_input(**kw) -> PolicyInput:
    now = kw.pop("now", T0)
    input_age = kw.pop("input_age_sec", 3.0)
    hr_now = kw.pop("hr_now", 150.0)
    speed_now = kw.pop("speed_now", 1000 / 360)
    pace_now = kw.pop("pace_now", 360.0)
    recent = kw.pop("recent_cells", ((150.0, 1000 / 360),) * 12)
    future_grade = kw.pop("future_grade", 0.0)
    pred = kw.pop("pred", {})
    goal = kw.pop("goal", {"targetDistanceM": 5000, "targetDurationSec": 1800, "targetPaceSecPerKm": None})
    internal_goal_preference = kw.pop("goalPreference", 0.5)
    if not 0.0 <= internal_goal_preference <= 1.0:
        raise ValueError("internal goalPreference must be between 0 and 1")
    ctx = {
        "sessionId": 201, "stateVersion": 7, "runState": "RUNNING", "mode": "COURSE", "goal": goal,
        "goalPreference": 0.5, "plan": None, "anchorPaceSecPerKm": 360,
        "currentGuidePaceSecPerKm": 360, "guidePaceSetAt": T0 - timedelta(seconds=120),
        "activeSec": 900, "distanceM": 2500, "routeProgressM": 2500,
        "inputAsOf": now - timedelta(seconds=input_age),
        "hrReference": {"hrMaxBpm": None, "rhrBpm": 60, "ageYears": 30,
                        "recentPeakHrBpm": None, "recentRunCount": 0},
        "lastCoaching": None, "resumedAt": None,
    }
    aliases = {"plan": "plan", "anchorPaceSecPerKm": "anchorPaceSecPerKm",
               "currentGuidePaceSecPerKm": "currentGuidePaceSecPerKm", "guidePaceSetAt": "guidePaceSetAt",
               "resumedAt": "resumedAt", "activeSec": "activeSec", "distanceM": "distanceM"}
    for key, alias in aliases.items():
        if key in kw:
            ctx[alias] = kw.pop(key)
    context = DecideContext.model_validate(ctx)
    # The public API schema fixes v0 preference at 0.5; MPC experiments use an
    # internal policy context and retain the full 0..1 range.
    if internal_goal_preference != 0.5:
        context = context.model_copy(update={"goal_preference": internal_goal_preference})
    candidates = []
    for i, delta in enumerate(DELTAS):
        pace = context.anchor_pace_sec_per_km + delta
        grade = None if future_grade is None else (future_grade,) * 24
        candidates.append(PolicyCandidate(delta, pace, 1000 / pace, tuple(pred.get(i, (150.0, 152.0, 154.0))), grade))
    return PolicyInput(now, input_age, hr_now, speed_now, pace_now, tuple(recent), context, tuple(candidates))


def outcome_for(after=3.0, distanceM=2310.0, **context_overrides):
    from app.decide.service import run_decide
    body = decide_body(**{"distanceM": distanceM, **context_overrides})
    request = DecideRequest.model_validate(body)
    at = T0 + timedelta(seconds=after)
    return run_decide(request, FakeModel5(), FakePolicy(), received_at=at, now=lambda: at)


def mk_trace(at_sec, distance_m, hr_now, chosen=1, paces=(330, 335, 340, 345, 350), pred120=(160, 158, 157, 156, 155)):
    as_of = T0 + timedelta(seconds=at_sec)
    return {"traceId": f"t{at_sec}", "inputAsOf": as_of.isoformat().replace("+00:00", "Z"), "status": "OK",
            "input": {"hrNowBpm": hr_now, "distanceM": distance_m, "paceNowSecPerKm": 340},
            "candidates": [{"deltaSecPerKm": d, "paceSecPerKm": p, "predHrBpm": [150, 155, pred120[i]]}
                           for i, (d, p) in enumerate(zip(DELTAS, paces))],
            "decision": {"action": "GUIDE_PACE" if chosen is not None else "EASE_OFF", "chosenIndex": chosen,
                         "recommendedPaceSecPerKm": paces[chosen] if chosen is not None else None}}


def with_check(trace, error_or_None):
    result = copy.deepcopy(trace)
    result["check120"] = {"comparable": error_or_None is not None,
                          "recommended": {"errorBpm": error_or_None} if error_or_None is not None else None}
    return result


def slope(length=1000, pct=5.0, n=11):
    from app.demo.course import CourseProfile
    d = [length * i / (n - 1) for i in range(n)]
    return CourseProfile(tuple(d), tuple(x * pct / 100 for x in d), tuple(0.0 for _ in d), tuple(0.0 for _ in d))


def ms(sec, hr=150.0, spd=3.0, dist=None, grade=None):
    from app.demo.w07 import MetricSample
    return MetricSample(type="METRIC_SAMPLE", measuredAt=T + timedelta(seconds=sec), elapsedDurationSec=sec,
                        heartRateBpm=hr, cadenceSpm=None, speedMps=spd, gradePercent=grade,
                        totalDistanceM=dist, routeProgressM=None, isHrMeasured=hr is not None)


def demo_settings(tmp_path, allow=None, stage="L1A", include_course=True):
    from app.demo.config import DemoSettings, load_demo_config
    tmp_path = Path(tmp_path)
    course = tmp_path / "course.json"
    course.write_text(json.dumps({"points": [{"lon": 127.0, "lat": 37.0, "elevationM": 0.0},
                                               {"lon": 127.0, "lat": 37.001, "elevationM": 5.0}]}), encoding="utf-8")
    config_path = tmp_path / "demo.json"
    profile = {"stage": stage, "label": "러너 A", "courseFile": course.name if include_course else None, "mode": "COURSE",
               "goal": {"targetDistanceM": 5000, "targetDurationSec": 1800, "targetPaceSecPerKm": None},
               "goalPreference": 0.5, "plan": None,
               "hrReference": {"hrMaxBpm": None, "rhrBpm": 58, "ageYears": 29,
                               "recentPeakHrBpm": 187.0, "recentRunCount": 5}}
    obj = {"live": profile, "replay": [{**profile, "sessionId": 900000001, "label": "리허설 기록"}],
           "sessionAllowlist": list(allow) if allow is not None else None,
           "skipPayloadHashDeviceIds": [900000101]}
    config_path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    return DemoSettings(True, "v" * 32, "i" * 32, load_demo_config(config_path))


def demo_client(tmp_path, allow=None, after=3.0, stage="L1A", rate=1000, include_course=True):
    from fastapi.testclient import TestClient
    from app.main import create_app
    settings = demo_settings(tmp_path, allow=allow, stage=stage, include_course=include_course)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(after),
                     demo_loader=lambda: settings, demo_rate_per_sec=rate)
    return TestClient(app)


def new_buffer():
    from app.demo.buffer import DemoBuffer
    return DemoBuffer("b", allowlist=None, now=lambda: T)


def tr(sec):
    return {"traceId": str(sec), "inputAsOf": (T + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")}


async def _false():
    return False


VIEW = {"Authorization": "Bearer " + "v" * 32}
INGEST = {"Authorization": "Bearer " + "i" * 32}


def batch_json(session, seconds, hr=150.0, spd=3.0, grade=None, device=900000101, same_id_as=None):
    from app.demo.w07 import payload_hash
    item = {"type": "METRIC_SAMPLE", "measuredAt": (T0 + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"),
            "elapsedDurationSec": seconds, "heartRateBpm": hr, "cadenceSpm": None, "speedMps": spd,
            "gradePercent": grade, "totalDistanceM": seconds * 3.0, "routeProgressM": None,
            "isHrMeasured": hr is not None}
    seed = hashlib.sha256(f"{session}:{seconds}:{device}".encode()).digest()[:16]
    raw = {"id": str(uuid.UUID(bytes=seed, version=4)), "deviceId": device, "sessionId": session, "schemaVersion": "1",
           "items": [item], "payloadHash": "0" * 64}
    if same_id_as is not None:
        original = json.loads(same_id_as if isinstance(same_id_as, bytes) else json.dumps(same_id_as))
        raw["id"] = original["id"]
    raw["payloadHash"] = payload_hash(raw)
    return json.dumps(raw, separators=(",", ":")).encode()


def gps_batch_json(session, seconds, points=None):
    from app.demo.w07 import payload_hash
    points = points or [(127.0, 37.5, None)]
    items = [{"type": "GPS_POINT",
              "measuredAt": (T0 + timedelta(seconds=seconds + index * 5)).isoformat().replace("+00:00", "Z"),
              "coordinates": [longitude, latitude], "accuracyM": 5.0, "altitudeM": altitude}
             for index, (longitude, latitude, altitude) in enumerate(points)]
    raw = {"id": str(uuid.uuid4()), "deviceId": 900000101, "sessionId": session,
           "schemaVersion": "1", "items": items, "payloadHash": "0" * 64}
    raw["payloadHash"] = payload_hash(raw)
    return json.dumps(raw, separators=(",", ":")).encode()


def post_run(c, sid, secs, **kw):
    return [c.post(f"/v1/demo/sessions/{sid}/batches", content=batch_json(sid, s, **kw), headers=INGEST) for s in secs]
