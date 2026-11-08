"""W07 → AI06 변환 예시가 AI06 요청 검증과 ODE 전처리를 통과하는지 확인한다 (S15P31E105-411).

예시는 합성 값이며 모델 파일 없이 돈다. 규칙: docs/design/api/w07-ai06-conversion.md
"""
import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ode_schemas import PersonalizeRequest
from app.personalization import _records
from demo_fakes import FakeModel5, FakePolicy
from tools.w07_to_ai06 import _pick_route_points, build_request, convert_session

EXAMPLES = Path(__file__).resolve().parent / "fixtures" / "w07_ai06"
CASES = ("normal", "missing", "pause", "low_quality", "mixed_gps")


def _load(case, kind):
    return json.loads((EXAMPLES / f"{case}.{kind}.json").read_text(encoding="utf-8"))


def _rows(case):
    return {r["elapsedSec"]: r for r in _load(case, "ai06_request")["sessions"][0]["samples"]}


@pytest.mark.parametrize("case", CASES)
def test_example_request_passes_ai06_validation(case):
    body = PersonalizeRequest.model_validate(_load(case, "ai06_request"))
    samples = body.sessions[0].samples
    assert [s.elapsed_sec for s in samples] == [5 * i for i in range(len(samples))]
    for s in samples:
        for value, quality in ((s.hr_bpm, s.hr_quality), (s.speed_mps, s.speed_quality),
                               (s.grade_percent, s.grade_quality)):
            assert (value is None) == (quality == "MISSING")
        assert not (s.hr_is_filled and s.hr_bpm is None)


@pytest.mark.parametrize("case", CASES)
def test_reference_converter_reproduces_expected_request(case):
    src = _load(case, "w07")
    assert build_request(src["userId"], src["sessions"]) == _load(case, "ai06_request")


@pytest.mark.parametrize("case", CASES)
def test_example_request_reaches_ode_after_http_validation(case):
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: None)
    with TestClient(app) as c:
        response = c.post("/v1/hr/personalize", json=_load(case, "ai06_request"))
    # 요청 검증을 통과하면 모델이 없어서 503 MODEL_NOT_READY가 된다(400/422가 아니다).
    assert response.status_code == 503
    assert response.json()["code"] == "MODEL_NOT_READY"


@pytest.mark.parametrize("case,usable", [("normal", True), ("missing", True), ("pause", True),
                                         ("low_quality", False), ("mixed_gps", True)])
def test_example_survives_ode_session_preprocessing(case, usable):
    body = PersonalizeRequest.model_validate(_load(case, "ai06_request"))
    records, start_hrs, _package, _fill_info = _records(body, runtime=None)
    assert len(records) == 1 and start_hrs == [97.0]
    rec = records[0]
    assert rec.usable is usable
    assert rec.prep["n_cell"] >= 4                       # 2분 이상 action이 이어진다


def test_normal_first_rows_follow_training_start_rules():
    rows = _rows("normal")
    assert rows[0]["hrQuality"] == "GOOD" and rows[0]["hrIsFilled"] is False    # 출발 HR = 실측
    assert rows[0]["speedQuality"] == "MISSING" and rows[0]["gradeQuality"] == "MISSING"
    assert rows[10]["speedMps"] == 2.8
    assert rows[25]["gradePercent"] == 2.0                # DEM 2% 오르막


def test_missing_hr_is_held_15s_as_filled_then_missing():
    rows = _rows("missing")                               # 공백 전 마지막 HR: 57초, 다음: 112초
    assert rows[60]["hrIsFilled"] is False
    assert rows[65]["hrIsFilled"] is True and rows[70]["hrIsFilled"] is True
    assert rows[70]["hrBpm"] == rows[60]["hrBpm"]
    assert rows[75]["hrBpm"] is None and rows[75]["hrQuality"] == "MISSING" and rows[75]["hrIsFilled"] is False
    assert rows[115]["hrQuality"] == "GOOD" and rows[115]["hrIsFilled"] is False
    assert rows[130]["speedQuality"] == "MISSING"         # 누적 거리 공백


def test_pause_uses_wall_clock_time_not_active_duration():
    src = _load("pause", "w07")
    rows = _rows("pause")
    assert len(rows) == 73                                # 360초 벽시계. active 시간이면 270초(55행)
    assert rows[160]["hrIsFilled"] is True                # 멈춤 직후 15초는 마지막 HR을 채움으로 이어 쓴다
    assert all(rows[t]["hrQuality"] == "MISSING" for t in range(170, 240, 5))
    assert rows[240]["hrQuality"] == "GOOD"
    assert rows[240]["speedQuality"] == "MISSING"         # 멈춤 뒤 첫 거리 간격은 새 구간
    resumed = [s for s in src["sessions"][0]["metricSamples"] if s["measuredAt"] >= "2026-11-01T00:04:02Z"]
    assert resumed[0]["elapsedDurationSec"] < 242
    assert _load("pause", "ai06_request")["sessions"][0]["workoutQuality"] == "USABLE_WITH_FLAGS"


def test_low_quality_marks_artefacts_and_unusable_run():
    rows = _rows("low_quality")
    assert rows[15]["hrQuality"] == "LOW"                 # HR 튐은 버리고 그 칸만 LOW
    assert rows[15]["hrBpm"] == 109.0
    assert rows[150]["speedQuality"] == "LOW" and rows[150]["speedMps"] == 2.8
    assert _load("low_quality", "ai06_request")["sessions"][0]["workoutQuality"] == "UNUSABLE"


def _session(sid, started, **overrides):
    base = copy.deepcopy(_load("normal", "w07")["sessions"][0])
    shift_day = started
    for s in base["metricSamples"] + base["routePoints"]:
        s["measuredAt"] = s["measuredAt"].replace("2026-11-01", shift_day)
    base.update(sessionId=sid, startedAt=f"{shift_day}T00:00:00Z", **overrides)
    return base


def test_session_selection_rules():
    days = [f"2026-09-{d:02d}" for d in range(1, 31)] + [f"2026-10-{d:02d}" for d in range(1, 32)]
    sessions = [_session(100 + i, day) for i, day in enumerate(days)]
    sessions[-1]["status"] = "INTERRUPTED"
    sessions[-2]["deletedAt"] = "2026-11-02T00:00:00Z"
    sessions[-3]["metricSamples"] = [s for s in sessions[-3]["metricSamples"] if not s["isHrMeasured"]]
    body = build_request(73, sessions)
    ids = [s["sessionId"] for s in body["sessions"]]
    assert len(ids) == 50
    assert ids[0] == 100 + len(days) - 4                  # 최신 3개는 상태·삭제·HR 없음으로 빠진다
    assert ids == sorted(ids, reverse=True)
    assert convert_session(sessions[-3]) == (None, "NO_START_HR")
    assert build_request(73, sessions[-3:]) is None


def test_short_run_is_not_sent():
    short = _session(1, "2026-10-01")
    short["metricSamples"] = [s for s in short["metricSamples"] if s["measuredAt"] < "2026-10-01T00:01:58Z"]
    short["routePoints"] = [p for p in short["routePoints"] if p["measuredAt"] < "2026-10-01T00:01:58Z"]
    assert convert_session(short) == (None, "TOO_SHORT")  # 24행 = 115초


def test_mixed_gps_uses_watch_first_and_fills_watch_gap_with_phone():
    src = _load("mixed_gps", "w07")
    rows = _rows("mixed_gps")
    # 워치 GPS가 끊긴 78~148초도 폰 점으로 채워 2% 오르막이 그대로 이어진다
    assert all(rows[t]["gradeQuality"] == "GOOD" and abs(rows[t]["gradePercent"] - 2.0) <= 0.05
               for t in range(25, 235, 5))
    # 두 기기 점을 모두 이으면 옆으로 3.6m 떨어진 점을 오가며 거리가 부풀어 경사가 틀어진다
    naive = copy.deepcopy(src)
    for p in naive["sessions"][0]["routePoints"]:
        p["deviceType"] = "WATCH"
    mixed = {r["elapsedSec"]: r for r in build_request(73, naive["sessions"])["sessions"][0]["samples"]}
    assert mixed[50]["gradePercent"] < 1.7


def test_phone_point_is_used_only_where_no_watch_point_within_15s():
    def pt(t, device):
        return (t, {"deviceType": device})
    route = [pt(0, "WATCH"), pt(2, "PHONE"), pt(15, "PHONE"), pt(16, "PHONE"), pt(40, "PHONE"),
             pt(55, "PHONE"), pt(56, "PHONE"), pt(70, "WATCH"), pt(71, None)]
    kept = [(t, p["deviceType"]) for t, p in _pick_route_points(route)]
    assert kept == [(0, "WATCH"), (16, "PHONE"), (40, "PHONE"), (70, "WATCH")]
