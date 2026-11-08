"""AI09 백엔드 연동 준비(S15P31E105-487): 구간 비율 0.85~1.20 제한, X-Request-Deadline, 응답 스키마."""
import asyncio
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
import random
import threading

from fastapi.testclient import TestClient
import httpx
import pytest

from app.main import create_app
from app.personal_plan import (
    PACE_RATIO_MAX,
    PACE_RATIO_MIN,
    SEGMENT_RATIO_CLAMPED,
    PopulationMeanPlanSnapshot,
    clamp_segment_ratios,
    finalize_personal_segments,
    finalize_personal_segments_with_clamp,
    finish_sec_from_segments,
    split_distance_1km,
)
from demo_fakes import FakeModel5, FakePolicy
from test_personal_plan_service import CourseLookup, PersonalLookup

_ONE = Decimal(1)
_MICRO = Decimal("0.000001")
_CENT = Decimal("0.01")


def _weighted_mean(lengths, ratios):
    return sum(Decimal(str(length)) * Decimal(str(ratio)) for length, ratio in zip(lengths, ratios)) / sum(
        Decimal(str(length)) for length in lengths)


def _random_case(rng):
    count = rng.randint(1, 45)
    remainder = Decimal(str(round(rng.uniform(0.01, 1000.0), 2)))
    lengths = (Decimal(1000),) * (count - 1) + (remainder,)
    spread = rng.choice((0.03, 0.1, 0.25, 0.5, 1.0))
    if rng.random() < 0.5:
        ratios = [rng.lognormvariate(0.0, spread) for _ in range(count)]
    else:
        ratios = [rng.uniform(0.3, 2.5) for _ in range(count)]
    raw = tuple(Decimal(repr(value)) for value in ratios)
    if rng.random() < 0.8:
        # 실제 호출처럼 거리 가중 평균 1로 맞춘 입력(일부는 맞추지 않은 입력도 섞는다).
        mean = _weighted_mean(lengths, raw)
        raw = tuple(value / mean for value in raw)
    return lengths, raw


# ---------------------------------------------------------------- clamp_segment_ratios


@pytest.mark.parametrize(("ratios", "expected"), [
    # 공유 패키지 0002가 '맞출 수 없음'으로 처리하던 입력(검토 재현 사례).
    (("0.75", "1.25"), ("0.85", "1.15")),
    (("0.8", "0.8", "1.4"), ("0.9", "0.9", "1.2")),
    # 재배율 뒤 다른 경계에 닿는 경우.
    (("1.5", "1.19", "0.9", "0.41"), ("1.2", "1.1", "0.85", "0.85")),
])
def test_clamp_finds_the_common_scale_for_inputs_the_fixed_point_method_rejected(ratios, expected):
    lengths = (Decimal(1000),) * len(ratios)
    bounded, clamped = clamp_segment_ratios(lengths, tuple(Decimal(value) for value in ratios))

    assert clamped is True
    assert all(abs(value - Decimal(target)) <= Decimal("1e-30") for value, target in zip(bounded, expected))
    assert abs(_weighted_mean(lengths, bounded) - _ONE) <= Decimal("1e-20")


def test_clamp_keeps_in_range_unit_mean_input_unchanged():
    lengths = (Decimal(1000), Decimal(1000), Decimal(1000))
    ratios = (Decimal("0.85"), Decimal("0.95"), Decimal("1.20"))

    assert clamp_segment_ratios(lengths, ratios) == (ratios, False)


def test_clamp_keeps_short_final_segment_in_the_weighted_mean():
    lengths = (Decimal(1000), Decimal("0.01"))
    bounded, clamped = clamp_segment_ratios(lengths, (Decimal("0.999995"), Decimal("1.5")))

    assert clamped is True
    assert bounded[1] == PACE_RATIO_MAX
    assert abs(_weighted_mean(lengths, bounded) - _ONE) <= Decimal("1e-20")


def test_clamp_single_segment_is_rescaled_to_one_without_hitting_a_bound():
    bounded, clamped = clamp_segment_ratios((Decimal("734.5"),), (Decimal("1.7"),))

    # 공통 배율만으로 1이 되므로 경계에 닿은 구간은 없다(잘림 아님).
    assert clamped is False
    assert abs(bounded[0] - _ONE) <= Decimal("1e-40")


@pytest.mark.parametrize(("lengths", "ratios"), [
    ((), ()),
    ((1000,), (1.0, 1.0)),
    ((1000, 0), (1.0, 1.0)),
    ((1000, 1000), (1.0, -1.0)),
    ((1000, 1000), (1.0, float("nan"))),
])
def test_clamp_rejects_malformed_inputs(lengths, ratios):
    with pytest.raises(ValueError):
        clamp_segment_ratios(lengths, ratios)


def test_clamp_property_range_unit_mean_order_and_no_false_infeasible():
    """6,000개 무작위 입력: 예외 없음(해가 항상 있음), 범위 안, 반올림 뒤 평균 1±1e-6, 순서 유지, 결정성."""
    rng = random.Random(487)
    clamped_cases = 0
    for _ in range(6000):
        lengths, ratios = _random_case(rng)
        bounded, clamped = clamp_segment_ratios(lengths, ratios)
        assert (bounded, clamped) == clamp_segment_ratios(lengths, ratios)
        rounded = tuple(value.quantize(_MICRO, rounding=ROUND_HALF_UP) for value in bounded)

        assert all(PACE_RATIO_MIN <= value <= PACE_RATIO_MAX for value in bounded)
        assert all(PACE_RATIO_MIN <= value <= PACE_RATIO_MAX for value in rounded)
        assert abs(_weighted_mean(lengths, bounded) - _ONE) <= Decimal("1e-20")
        assert abs(_weighted_mean(lengths, rounded) - _ONE) <= Decimal("1e-6")
        order = sorted(range(len(ratios)), key=lambda index: ratios[index])
        assert all(bounded[left] <= bounded[right] for left, right in zip(order, order[1:]))
        in_range = all(PACE_RATIO_MIN <= value <= PACE_RATIO_MAX for value in ratios)
        unit_mean = abs(_weighted_mean(lengths, ratios) - _ONE) <= Decimal("1e-20")
        if in_range and unit_mean:
            assert clamped is False and bounded == ratios
        if not in_range and unit_mean:
            assert clamped is True
        clamped_cases += clamped
    assert clamped_cases > 1000   # 잘림 경로가 실제로 많이 검사됐는지


# ---------------------------------------------------------------- finalize


def test_finalize_property_goal_time_ratio_range_and_backend_reconstruction():
    """목표가 있으면: 비율 범위·평균 1, 완주시간 = 목표, 백엔드 '목표 페이스 × paceRatio'가 AI 페이스와 0.01초/km 안."""
    rng = random.Random(486487)
    clamped_cases = 0
    for _ in range(1500):
        distance = Decimal(str(round(rng.uniform(1000.0, 42195.0), 2)))
        goal_pace = Decimal(str(round(rng.uniform(242.3, 567.0), 2)))
        splits = split_distance_1km(distance)
        spread = rng.choice((0.02, 0.08, 0.2, 0.4))
        paces = tuple(round(rng.uniform(250.0, 560.0) * rng.lognormvariate(0.0, spread), 2) for _ in splits)

        segments, clamped = finalize_personal_segments_with_clamp(distance, goal_pace, paces,
                                                                   preserve_goal_duration=True)
        clamped_cases += clamped
        lengths = [segment.length_m for segment in segments]
        ratios = [segment.pace_ratio for segment in segments]
        assert all(0.85 <= ratio <= 1.20 for ratio in ratios)
        assert abs(_weighted_mean(lengths, ratios) - _ONE) <= Decimal("1e-6")
        target_finish = int((distance * goal_pace / 1000).quantize(_ONE, rounding=ROUND_HALF_UP))
        assert finish_sec_from_segments(segments) == target_finish
        for segment in segments:
            backend = (goal_pace * Decimal(str(segment.pace_ratio))).quantize(_CENT, rounding=ROUND_HALF_UP)
            assert abs(backend - Decimal(str(segment.pace_sec_per_km))) <= _CENT
        if not clamped:
            # 범위 안이면 페이스는 예전처럼 목표 배율만 곱한 값을 두 자리로 반올림한 값이다
            # (완주시간을 맞출 때만 일부 구간의 반올림 방향이 바뀌어 0.01 안에서 다를 수 있다).
            mean = sum(Decimal(str(length)) * Decimal(str(pace)) for length, pace
                       in zip(lengths, paces)) / distance
            exact = [Decimal(str(pace)) * goal_pace / mean for pace in paces]
            assert all(abs(Decimal(str(segment.pace_sec_per_km)) - value) < _CENT
                       for segment, value in zip(segments, exact))
    assert clamped_cases > 100


def test_finalize_switches_rounding_direction_only_when_the_goal_second_would_drift():
    # 목표 300.0496초/km × 10 km = 3000.496초 → 3000초. 구간마다 300.05로 올림되면 3000.5초 → 3001초였다(예전 동작).
    segments = finalize_personal_segments(Decimal("10000"), Decimal("300.0496"), (300,) * 10,
                                          preserve_goal_duration=True)

    assert finish_sec_from_segments(segments) == 3000
    assert sorted(segment.pace_sec_per_km for segment in segments) == [300.04] + [300.05] * 9
    assert [segment.pace_ratio for segment in segments] == [1.0] * 10


def test_finalize_without_goal_keeps_mean_pace_and_clamps_extreme_split():
    paces = (300,) * 9 + (450,)
    segments, clamped = finalize_personal_segments_with_clamp(10000, None, paces, preserve_goal_duration=False)

    assert clamped is True
    assert [segment.pace_ratio for segment in segments] == [0.977778] * 9 + [1.2]
    # 거리 가중 평균 페이스(315)는 그대로라 반올림 전 완주시간 3,150초가 유지된다.
    assert finish_sec_from_segments(segments) == 3150
    assert finalize_personal_segments(10000, None, paces, preserve_goal_duration=False) == segments


# ---------------------------------------------------------------- API


class ExtremePopulationLookup:
    """마지막 km만 매우 느린 평균 계획(비율 제한 경로를 API에서 확인한다)."""

    def get_population_mean_plan(self, course):
        return PopulationMeanPlanSnapshot(
            course_id=course.course_id, course_version=course.version,
            segment_paces_sec_per_km=(300.0, 300.0, 520.0),
            dataset_version="synthetic-test-fixture-v1", train_subject_count=2, train_run_count=3,
            course_coverage=0.94, source_scope="SYNTHETIC_TEST_FIXTURE_NOT_TRAIN_DATA",
        )


class CountingCourseLookup(CourseLookup):
    def __init__(self):
        self.calls = []

    def get_course(self, course_id):
        self.calls.append(course_id)
        return super().get_course(course_id)


_NOW = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)
_NOW_MS = int(_NOW.timestamp() * 1000)


def _app(*, population=None, course_lookup=None, clock=lambda: _NOW):
    return create_app(
        lambda: FakeModel5(), lambda: FakePolicy(), clock=clock,
        ode_loader=lambda: None,
        personal_plan_course_lookup=course_lookup or CourseLookup(),
        personal_plan_user_lookup=PersonalLookup(None),
        personal_plan_population_lookup=population or ExtremePopulationLookup(),
    )


def test_api_goal_plan_clamps_ratios_keeps_goal_time_and_warns_once():
    with TestClient(_app()) as client:
        response = client.post("/v1/pace/personal-plan", json={
            "userId": 73, "courseId": 297, "selectedGoal": {"targetDurationSec": 840}})

    assert response.status_code == 200, response.json()
    body = response.json()
    ratios = [segment["paceRatio"] for segment in body["segments"]]
    lengths = [segment["lengthM"] for segment in body["segments"]]
    assert all(0.85 <= ratio <= 1.20 for ratio in ratios)
    assert abs(_weighted_mean(lengths, ratios) - _ONE) <= Decimal("1e-6")
    assert body["warnings"].count(SEGMENT_RATIO_CLAMPED) == 1
    assert body["predictedFinishSec"] == 840
    goal_pace = Decimal(str(body["targetPaceSecPerKm"]))
    for segment in body["segments"]:
        backend = (goal_pace * Decimal(str(segment["paceRatio"]))).quantize(_CENT, rounding=ROUND_HALF_UP)
        assert abs(backend - Decimal(str(segment["paceSecPerKm"]))) <= _CENT


def test_api_in_range_plan_has_no_clamp_warning():
    from test_personal_plan_service import PopulationLookup

    with TestClient(_app(population=PopulationLookup())) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 200
    assert SEGMENT_RATIO_CLAMPED not in response.json()["warnings"]


def test_expired_deadline_returns_503_without_course_lookup():
    lookup = CountingCourseLookup()
    with TestClient(_app(course_lookup=lookup)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297},
                               headers={"X-Request-Deadline": str(_NOW_MS)})

    assert response.status_code == 503
    assert response.json()["code"] == "DEADLINE_EXCEEDED"
    assert response.json()["details"]["fields"][0]["name"] == "X-Request-Deadline"
    assert lookup.calls == []


def test_future_deadline_allows_a_normal_plan():
    with TestClient(_app()) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297},
                               headers={"X-Request-Deadline": str(_NOW_MS + 5000)})

    assert response.status_code == 200


@pytest.mark.parametrize("value", ["tomorrow", "1.5", "", "12345678901234567890"])
def test_malformed_deadline_is_a_validation_error(value):
    lookup = CountingCourseLookup()
    with TestClient(_app(course_lookup=lookup)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297},
                               headers={"X-Request-Deadline": value})

    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.json()["details"]["fields"][0]["name"] == "X-Request-Deadline"
    assert lookup.calls == []


def test_deadline_passing_while_queued_is_checked_before_compute(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    clock_ms = [_NOW_MS]

    class BlockingCourseLookup(CountingCourseLookup):
        def get_course(self, course_id):
            if not self.calls:
                self.calls.append(course_id)
                entered.set()
                assert release.wait(3)
                return CourseLookup.get_course(self, course_id)
            return super().get_course(course_id)

    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "2")
    lookup = BlockingCourseLookup()
    app = _app(course_lookup=lookup,
               clock=lambda: datetime.fromtimestamp(clock_ms[0] / 1000, tz=timezone.utc))

    async def send():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                body = {"userId": 73, "courseId": 297}
                first = asyncio.create_task(client.post("/v1/pace/personal-plan", json=body))
                assert await asyncio.to_thread(entered.wait, 2)
                deadline_ms = _NOW_MS + 1000
                second = asyncio.create_task(client.post(
                    "/v1/pace/personal-plan", json=body, headers={"X-Request-Deadline": str(deadline_ms)}))
                await asyncio.sleep(0.1)
                assert not second.done()
                clock_ms[0] = deadline_ms + 1
                release.set()
                return await asyncio.gather(first, second)

    first_response, second_response = asyncio.run(send())
    assert first_response.status_code == 200
    assert second_response.status_code == 503
    assert second_response.json()["code"] == "DEADLINE_EXCEEDED"
    assert lookup.calls == [297]


def test_openapi_ai09_response_schema_is_the_personal_plan_response():
    with TestClient(_app()) as client:
        schema = client.get("/openapi.json").json()

    response = schema["paths"]["/v1/pace/personal-plan"]["post"]["responses"]["200"]
    ref = response["content"]["application/json"]["schema"]["$ref"].rsplit("/", 1)[-1]
    properties = schema["components"]["schemas"][ref]["properties"]
    assert {"segments", "predictedFinishSec", "targetPaceSecPerKm", "warnings"}.issubset(properties)
    segment_ref = properties["segments"]["items"]["$ref"].rsplit("/", 1)[-1]
    assert {"paceSecPerKm", "paceRatio", "lengthM"}.issubset(
        schema["components"]["schemas"][segment_ref]["properties"])
