"""AI10은 실제 정책 계산과 가짜 GRU로 그룹 공동 페이스를 확인한다."""
from datetime import timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.hr_threshold_lookup import HrThresholdLookupResult
from app.inference import ApiError
from app.models.base import ModelInfo
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, decide_body, flat_table


class GroupModel:
    info = ModelInfo("gru", "group-test", 360, 1)

    def __init__(self, predict_hr=None):
        self.predict_hr = predict_hr or (lambda pace, hr: [140.0] * 3)
        self.batches = []

    def predict(self, batch):
        self.batches.append(batch)
        return np.asarray([self.predict_hr(1000.0 / float(speed[0]), float(hr[-1]))
                           for speed, hr in zip(batch["future_speed"], batch["hr"])])


def participant(user_id=1, pace=340, hr=150, n=12, grade=0.0):
    return {"userId": user_id, "active": True,
            "history": {"hrBpm": [hr] * n, "speedMps": [1000 / pace] * n, "gradePct": [grade] * n},
            "futureGradePct": None}


def body(**overrides):
    data = {"groupRunId": 3, "currentGroupPaceSecPerKm": 340,
            "goalPaceSecPerKm": 320, "startRecommendedPaceSecPerKm": None,
            "elapsedSec": 300, "now": T0.isoformat(), "lastChange": None,
            "participants": [participant()]}
    data.update(overrides)
    return data


@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "true")


def run(data=None, model=None, margins=None, lookup=None):
    from app.group_pace.schemas import GroupPaceRequest
    from app.group_pace.service import recommend_group_pace

    return recommend_group_pace(GroupPaceRequest.model_validate(data or body()), model or GroupModel(),
                                MpcPolicy(load_policy_config(), margins or flat_table(0)),
                                hr_threshold_lookup=lookup, hr_threshold_lookup_configured=lookup is not None)


def test_flag_off_and_health(monkeypatch):
    monkeypatch.delenv("GROUP_PACE_ENABLED", raising=False)
    with TestClient(create_app(lambda: GroupModel(), lambda: MpcPolicy(load_policy_config(), flat_table(0)))) as c:
        response = c.post("/v1/group/pace", json=body())
        assert response.status_code == 503
        assert response.json()["code"] == "GROUP_PACE_DISABLED"
        assert response.json()["details"] is None
        assert c.get("/health").json()["components"]["groupPace"]["enabled"] is False


@pytest.mark.parametrize("changes", [
    {"participants": []}, {"currentGroupPaceSecPerKm": 0}, {"goalPaceSecPerKm": -1},
    {"startRecommendedPaceSecPerKm": float("inf")}, {"elapsedSec": -1},
    {"now": "2026-11-05T00:00:00"}, {"groupRunId": True},
    {"lastChange": {"direction": "HOLD", "changedAt": T0.isoformat()}},
    {"lastChange": {"direction": "SLOW", "changedAt": (T0 + timedelta(seconds=1)).isoformat()}},
])
def test_request_validation(changes):
    from app.group_pace.schemas import GroupPaceRequest

    with pytest.raises(ValidationError):
        GroupPaceRequest.model_validate(body(**changes))


def test_participant_validation():
    from app.group_pace.schemas import GroupPaceRequest

    for patch in ({"futureGradePct": [0] * 23}, {"futureGradePct": [float("nan")] * 24},
                  {"userId": True}, {"active": "false"},
                  {"history": {"hrBpm": [150], "speedMps": [3, 3], "gradePct": [0]}}):
        p = participant()
        p.update(patch)
        with pytest.raises(ValidationError):
            GroupPaceRequest.model_validate(body(participants=[p]))


def test_slowdown_chooses_smallest_passing_for_everyone():
    model = GroupModel(lambda pace, hr: [190, 190, 160 if pace > (359 if hr == 151 else 344) else 170])
    result = run(body(participants=[participant(hr=150), participant(2, hr=151)]), model)
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (360, "SLOW", "HR_LIMIT")
    assert result.changed and result.struggling_count == 0


def test_floor_retains_struggling_runner():
    result = run(model=GroupModel(lambda pace, hr: [180] * 3))
    assert (result.group_pace_sec_per_km, result.reason, result.struggling_count) == (400, "FLOOR", 1)


def test_progress_raises_allow_line_so_previously_failing_candidate_passes():
    model = GroupModel(lambda pace, hr: [170] * 3)
    start = run(body(progressRatio=0.0), model)
    finish = run(body(progressRatio=1.0), model)
    assert (start.group_pace_sec_per_km, start.reason, start.struggling_count) == (400, "FLOOR", 1)
    assert (finish.group_pace_sec_per_km, finish.reason, finish.struggling_count) == (320, "RECOVERED", 0)


@pytest.mark.parametrize("progress,normalized,expected", [(None, None, 400), (-0.5, 0.0, 400), (1.5, 1.0, 320)])
def test_progress_null_defaults_to_start_and_out_of_range_is_clamped(progress, normalized, expected):
    from app.group_pace.schemas import GroupPaceRequest

    assert GroupPaceRequest.model_validate(body(progressRatio=progress)).progress_ratio == normalized
    result = run(body(progressRatio=progress), GroupModel(lambda pace, hr: [170] * 3))
    assert result.group_pace_sec_per_km == expected


@pytest.mark.parametrize("progress", [float("nan"), float("inf"), -float("inf")])
def test_progress_must_be_finite(progress):
    from app.group_pace.schemas import GroupPaceRequest

    with pytest.raises(ValidationError):
        GroupPaceRequest.model_validate(body(progressRatio=progress))


def test_recovery_chooses_thirty_faster_when_everyone_passes():
    result = run(body(goalPaceSecPerKm=300, participants=[participant(), participant(2, hr=151)]))
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (310, "FAST", "RECOVERED")
    assert result.changed and result.struggling_count == 0


def test_recovery_chooses_twenty_faster_when_thirty_fails_for_one_runner():
    model = GroupModel(lambda pace, hr: [160 if hr == 151 and pace < 315 else 150] * 3)
    result = run(body(goalPaceSecPerKm=300, participants=[participant(), participant(2, hr=151)]), model)
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (320, "FAST", "RECOVERED")
    assert result.changed and result.struggling_count == 0


@pytest.mark.parametrize("goal,start,expected", [(320, None, 320), (315, 300, 320),
                                                   (None, 315, 320), (335, 320, 340),
                                                   (None, 335, 340), (None, 340, 340),
                                                   (None, None, 340)])
def test_recovery_caps(goal, start, expected):
    result = run(body(goalPaceSecPerKm=goal, startRecommendedPaceSecPerKm=start))
    assert result.group_pace_sec_per_km == expected
    assert result.changed == (expected != 340)


def test_speedup_requires_strict_three_bpm_band():
    # 모집단 지속 기준 163: 160은 경계라 탈락하고, 159.9는 통과한다.
    model = GroupModel(lambda pace, hr: [160 if pace < 325 else 159.9] * 3)
    assert run(model=model).group_pace_sec_per_km == 330


def test_current_and_speedup_use_all_prediction_horizons():
    # 빠른 후보의 30초 상한이 실패하면 120초가 낮아도 회복하지 않는다.
    model = GroupModel(lambda pace, hr: [165 if pace < 339 else 150, 150, 150])
    assert run(model=model).direction == "HOLD"
    # G의 30초만 넘는 경우도 감속 판단에 포함한다.
    model = GroupModel(lambda pace, hr: [165, 150, 150])
    assert run(model=model).group_pace_sec_per_km == 350


@pytest.mark.parametrize("direction", ["SLOW", "FAST"])
def test_cooldown_and_danger_exception(direction):
    data = body(lastChange={"direction": direction, "changedAt": (T0 - timedelta(seconds=119)).isoformat()})
    safe_slow = GroupModel(lambda pace, hr: [170 if pace < 344 else 150] * 3)
    held = run(data, safe_slow)
    assert (held.direction, held.reason, held.struggling_count) == ("HOLD", "COOLDOWN", 1)
    danger = GroupModel(lambda pace, hr: [178 if pace < 344 else 150] * 3)
    assert run(data, danger).direction == "SLOW"
    data["lastChange"]["changedAt"] = (T0 - timedelta(seconds=120)).isoformat()
    assert run(data, safe_slow).direction == "SLOW"
    data["lastChange"]["changedAt"] = (T0 - timedelta(seconds=119)).isoformat()
    assert run(data).reason == "COOLDOWN"


def test_warmup_cap_and_boundary():
    model = GroupModel(lambda pace, hr: [180] * 3)
    result = run(body(elapsedSec=179), model)
    assert (result.group_pace_sec_per_km, result.reason, result.struggling_count) == (350, "WARMUP_CAP", 1)
    assert run(body(elapsedSec=180), model).group_pace_sec_per_km == 400


@pytest.mark.parametrize("cap,pace,reason", [(331, 340, "SMALL_CHANGE"), (330, 330, "RECOVERED")])
def test_small_change_and_exactly_ten(cap, pace, reason):
    result = run(body(goalPaceSecPerKm=cap))
    assert (result.group_pace_sec_per_km, result.reason) == (pace, reason)
    assert result.changed == (pace != 340)


@pytest.mark.parametrize("delta,pace,direction,reason", [
    (-9, 340, "HOLD", "SMALL_CHANGE"), (-10, 330, "FAST", "RECOVERED"),
    (9, 340, "HOLD", "SMALL_CHANGE"), (10, 350, "SLOW", "HR_LIMIT"),
])
def test_nine_second_difference_holds_and_ten_changes(monkeypatch, delta, pace, direction, reason):
    # 정상 후보에는 없는 9초 차이도 주입해 변경 임계값 자체를 확인한다.
    monkeypatch.setattr("app.group_pace.service.DELTAS", tuple(sorted((0, delta))))
    model = GroupModel(lambda candidate, hr: [170 if delta > 0 and candidate < 345 else 150] * 3)
    result = run(body(goalPaceSecPerKm=300), model)
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (pace, direction, reason)
    assert result.changed == (pace != 340)


@pytest.mark.parametrize("user,hr", [(None, 150), (2, None)])
def test_pace_only_blocks_only_more_than_thirty_faster(user, hr):
    p = participant(user, pace=359, hr=hr)
    data = body(participants=[participant(), p])
    result = run(data)
    assert (result.group_pace_sec_per_km, result.pace_only_count) == (330, 1)
    data["participants"][1] = participant(user, pace=600, hr=hr)
    model = GroupModel(lambda pace, hr: [170 if pace < 344 else 150] * 3)
    # 현재보다 느려지는 후보는 미동의자의 기준 페이스와 무관하게 막지 않는다.
    assert run(data, model).group_pace_sec_per_km == 350


def test_inactive_excluded_and_no_data():
    p = participant(hr=200)
    p["active"] = False
    result = run(body(participants=[participant(), p]))
    assert result.excluded_count == 1 and result.group_pace_sec_per_km == 320
    result = run(body(participants=[p]))
    assert (result.reason, result.direction, result.excluded_count) == ("NO_DATA", "HOLD", 1)
    empty = participant(user_id=None, hr=None)
    empty["history"]["speedMps"] = [None] * 12
    assert run(body(participants=[empty])).reason == "NO_DATA"


def test_pace_only_group_uses_no_gru():
    model = GroupModel()
    result = run(body(participants=[participant(None, pace=359)]), model)
    assert result.group_pace_sec_per_km == 330 and result.pace_only_count == 1
    assert model.batches == []


def test_batch_once_for_multiple_participants_with_different_histories():
    model = GroupModel()
    data = body(participants=[participant(1, n=4), participant(2, n=80, grade=None), participant(None)])
    run(data, model)
    assert len(model.batches) == 1
    batch = model.batches[0]
    assert batch["hr"].shape == (18, 80)
    assert np.isnan(batch["hr"][0, :-4]).all()
    assert (batch["future_grade"] == 0).all()


def test_large_group_chunks_without_participant_cap():
    model = GroupModel()
    result = run(body(participants=[participant(i + 1) for i in range(60)]), model)
    assert result.group_pace_sec_per_km == 320
    assert sum(len(b["hr"]) for b in model.batches) == 540
    assert max(len(b["hr"]) for b in model.batches) <= 256


def test_slow_margin_forces_decel_and_unknown_uses_largest_cell():
    table = flat_table(0, {(120, "DECEL", "FLAT"): 1, (120, "DECEL", "UP"): 9,
                           (120, "DECEL", "DOWN"): 3})
    model = GroupModel(lambda pace, hr: [170, 170, 155] if pace > 344 else [170] * 3)
    data = body()
    assert run(data, model, table).group_pace_sec_per_km == 400
    data["participants"][0]["futureGradePct"] = [0] * 24
    assert run(data, model, table).group_pace_sec_per_km == 350


def test_current_and_fast_margin_direction_use_ai04_six_complete_cells():
    table = flat_table(0, {(120, "ACCEL", "FLAT"): 20})
    p = participant()
    p["futureGradePct"] = [0] * 24
    p["history"]["speedMps"] = [1.0] * 6 + [4.0] * 6
    model = GroupModel(lambda pace, hr: [150] * 3)
    # 최근 6칸 기준은 DECEL, 12칸 평균 기준은 ACCEL이므로 서로 다른 결과를 낸다.
    result = run(body(participants=[p]), model, table)
    assert result.direction == "FAST"
    p["history"]["speedMps"][-2] = None
    # 6칸 중 하나가 없으면 AI04처럼 방향 모름으로 가장 큰 셀을 사용한다.
    result = run(body(participants=[p]), model, table)
    assert result.direction == "SLOW" and result.group_pace_sec_per_km == 350


def test_slow_upper_equal_to_allow_fails():
    table = flat_table(2)
    model = GroupModel(lambda pace, hr: [180, 180, 160.9 if pace > 349 else 161])
    assert run(model=model, margins=table).group_pace_sec_per_km == 350


def test_cooldown_danger_exception_uses_raw_prediction_not_margin():
    data = body(lastChange={"direction": "FAST", "changedAt": (T0 - timedelta(seconds=30)).isoformat()})
    model = GroupModel(lambda pace, hr: [176 if pace < 344 else 150] * 3)
    result = run(data, model, flat_table(4))
    assert (result.reason, result.direction) == ("COOLDOWN", "HOLD")


def test_db_failure_uses_ai04_population_fallback():
    class BrokenLookup:
        def get_for_user(self, user_id):
            raise TimeoutError

    result = run(lookup=BrokenLookup())
    assert "HR_THRESHOLD_LOOKUP_UNAVAILABLE" in result.warnings
    assert result.group_pace_sec_per_km == 320


def test_personal_thresholds_use_same_blend_as_ai04():
    class Lookup:
        def __init__(self, count):
            self.count = count

        def get_for_user(self, user_id):
            return HrThresholdLookupResult(170, 150, self.count)

    model = GroupModel(lambda pace, hr: [155] * 3)
    assert run(model=model, lookup=Lookup(0)).direction == "FAST"
    personal = run(model=model, lookup=Lookup(5))
    assert (personal.reason, personal.struggling_count) == ("FLOOR", 1)


def test_pace_only_and_inactive_do_not_lookup_thresholds():
    class ForbiddenLookup:
        def get_for_user(self, user_id):
            pytest.fail("심박 판단 대상만 기준을 조회해야 한다")

    inactive = participant(9)
    inactive["active"] = False
    run(body(participants=[participant(None), participant(2, hr=None), inactive]), lookup=ForbiddenLookup())


def test_batch_preserves_segment_ids_and_prediction_is_base_only():
    model = GroupModel()
    model.predict_with_state = lambda *args: pytest.fail("AI10은 기본 GRU만 사용해야 한다")
    p = participant(n=4)
    p["history"]["segmentId"] = [3, 3, 4, 4]
    run(body(participants=[p, participant(2, n=8)]), model)
    batch = model.batches[0]
    assert list(batch["segment"][0]) == [-1] * 4 + [3, 3, 4, 4]
    assert list(batch["segment"][9]) == [0] * 8


@pytest.mark.parametrize("output", [np.zeros((1, 3)), np.full((9, 3), np.nan)])
def test_invalid_prediction_returns_common_error(output):
    class BadModel(GroupModel):
        def predict(self, batch):
            return output

    with pytest.raises(ApiError) as error:
        run(model=BadModel())
    assert error.value.status == 500 and error.value.code == "PREDICTION_FAILED"


def test_insufficient_hr_data_is_reported_and_skipped():
    p = participant()
    p["history"]["hrBpm"][-1] = None
    model = GroupModel()
    result = run(body(participants=[p]), model)
    assert result.reason == "NO_DATA" and result.excluded_count == 1
    assert "PARTICIPANT_DATA_UNUSABLE" in result.warnings and not model.batches


def test_route_and_existing_ai04_remain_available():
    model = GroupModel()
    with TestClient(create_app(lambda: model, lambda: MpcPolicy(load_policy_config(), flat_table(0)),
                               clock=lambda: T0)) as c:
        response = c.post("/v1/group/pace", json=body())
        assert response.status_code == 200
        assert response.json()["modelVersion"] == "group-test"
        assert response.json()["direction"] == "FAST"
        assert "X-RunWay-Queue-Wait-Ms" in response.headers
        assert c.get("/health").json()["components"]["groupPace"]["enabled"] is True
        data = decide_body()
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert c.post("/v1/hr/predict", json={key: data[key] for key in ("elapsedSec", "history", "candidates")}).status_code == 200


@pytest.mark.parametrize("missing_model", [True, False])
def test_route_model_or_policy_not_ready(missing_model):
    with TestClient(create_app(lambda: None if missing_model else GroupModel(),
                               lambda: MpcPolicy(load_policy_config(), flat_table(0)) if missing_model else None)) as c:
        response = c.post("/v1/group/pace", json=body())
        assert response.status_code == 503 and response.json()["code"] == "MODEL_NOT_READY"


def test_route_validation_uses_existing_error_style():
    with TestClient(create_app(lambda: GroupModel(), lambda: MpcPolicy(load_policy_config(), flat_table(0)))) as c:
        response = c.post("/v1/group/pace", json=body(participants=[]))
        assert response.status_code == 400 and response.json()["code"] == "VALIDATION_ERROR"


def test_flag_off_does_not_disable_ai03_or_ai04(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "false")
    with TestClient(create_app(lambda: GroupModel(), lambda: MpcPolicy(load_policy_config(), flat_table(0)),
                               clock=lambda: T0)) as c:
        data = decide_body()
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert c.post("/v1/hr/predict", json={key: data[key] for key in ("elapsedSec", "history", "candidates")}).status_code == 200
