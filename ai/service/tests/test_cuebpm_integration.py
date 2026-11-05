"""S15P31E105-456: AI04 목표 BPM(cueBpm) 연결 정확도.

1. 계산 일치: 같은 입력이면 AI04 응답 cueBpm과 ai/bpm/target_bpm.py를 직접 돌린 값이 같다(기록 없음·기록 있음·첫 1분).
2. DB 조회(438): 메모리 표(tools/memory_bpm_db.py)로 BPM SQL 4개의 조건을 흉내 내고, SQL 문장에 그 조건이 남아 있는지도 확인한다.
3. 끝값: 아주 느린·빠른 페이스와 모든 판단에서 60~220 정수가 나온다.
실제 PostgreSQL에서 같은 SQL을 돌려 보는 확인은 아직 하지 못했다(메모리 표는 SQL 조건을 흉내 낼 뿐이다).
"""
import importlib.util
import math
import sys
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.bpm_cue import CUE_BPM_UNAVAILABLE, CueBpmCalculator, UnavailableCueBpm, bpm_src_dir
from app.bpm_lookup import FETCH_RUNS, UNAVAILABLE_WARNING, CachedDbBpmLookup
from app.db_lookup import BPM_EVENTS_SQL, BPM_RUNS_SQL, BPM_WINDOWS_SQL, DatabaseUnavailable
from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, FakePolicy, decide_body, fixed_clock, flat_table
from tools.memory_bpm_db import MemoryBpmDb

CALC = CueBpmCalculator()


def _direct_target_bpm():
    """서비스가 쓰는 모듈과 별개로 ai/bpm/target_bpm.py 파일을 다시 읽어 기대값을 만든다."""
    src = bpm_src_dir()
    spec = importlib.util.spec_from_file_location("target_bpm_direct", src / "target_bpm.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["target_bpm_direct"] = module
    spec.loader.exec_module(module)
    return module, module.StridePrior.load(src / "stride_prior.json")


TB, PRIOR = _direct_target_bpm()


def expected_bpm(pace, records=(), first=None) -> int:
    windows = [TB.Window(r["runNo"], r["speedMps"], r["cadenceSpm"], r.get("cueBpm")) for r in records]
    selected = TB.select_records(windows)
    base = TB.target_bpm(pace, PRIOR, records=selected).bpm
    if selected or first is None:
        return base
    window = TB.Window(0, first["speedMps"], first["cadenceSpm"], first.get("cueBpm"))
    changed = TB.first_minute_bpm(base, pace, window, [], PRIOR)
    return changed.bpm if changed else base


def post(body, *, lookup=None, cue_loader=CueBpmCalculator, policy=None):
    app = create_app(lambda: FakeModel5(), lambda: policy or FakePolicy(), clock=fixed_clock(3.0),
                     cue_bpm_loader=cue_loader, bpm_lookup=lookup)
    with TestClient(app) as client:
        response = client.post("/v1/pace/decide", json=body)
    assert response.status_code == 200
    return response.json()


# --- 1. 계산 일치 -------------------------------------------------------------

RECORDS = [{"runNo": r, "speedMps": s, "cadenceSpm": c, "cueBpm": cue}
           for r, s, c, cue in [(1, 2.6, 163.0, None), (2, 2.9, 170.0, None), (3, 3.1, 174.0, 172.0),
                                (3, 2.8, 150.0, 165.0)]]          # 마지막은 BPM을 안 따라간 구간
FIRST = {"speedMps": 2.78, "cadenceSpm": 152.0, "cueBpm": 150.0}


@pytest.mark.parametrize("case,bpm", [
    ("no_records", {"records": [], "firstMinute": None}),
    ("records", {"records": RECORDS, "firstMinute": FIRST}),      # 기록이 있으면 첫 1분은 안 쓴다
    ("first_minute", {"records": [], "firstMinute": FIRST}),
])
def test_api_cue_bpm_equals_direct_target_bpm(case, bpm):
    body = decide_body(bpm=bpm)
    decision = post(body)["decision"]
    pace = decision["recommendedPaceSecPerKm"]
    assert decision["cueBpm"] == expected_bpm(pace, bpm["records"], bpm["firstMinute"])
    assert type(decision["cueBpm"]) is int


def test_first_minute_case_really_changes_bpm():
    """세 경우가 서로 다른 값을 내야 일치 확인이 의미가 있다."""
    pace = post(decide_body())["decision"]["recommendedPaceSecPerKm"]
    values = {expected_bpm(pace), expected_bpm(pace, RECORDS), expected_bpm(pace, (), FIRST)}
    assert len(values) == 3


# --- 2. DB 조회 ---------------------------------------------------------------

BASE = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)


def run(db, sid, user, minutes, *, day=0, status="COMPLETED", deleted=False, current_bpm=None,
        set_bpm_at_min=0.5, bpm=165.0, sample_every=5):
    """minutes: 분마다 (속도 m/s, 케이던스 spm). 0.5분에 BPM을 한 번 바꿔서 그 뒤 구간은 BPM을 안다."""
    start = BASE + timedelta(days=day)
    db.sessions.append({"id": sid, "user_id": user, "status": status, "deleted_at": start if deleted else None,
                        "ended_at": start + timedelta(minutes=len(minutes)) if status == "COMPLETED" else None,
                        "current_bpm": current_bpm})
    for minute, (speed, cadence) in enumerate(minutes):
        for k in range(60 // sample_every):
            sec = minute * 60 + k * sample_every
            jitter = 0.01 * (k % 3 - 1)
            db.samples.append({"session_id": sid, "elapsed": sec, "at": start + timedelta(seconds=sec),
                               "speed": None if speed is None else speed + jitter,
                               "cadence": None if cadence is None else cadence + 10 * jitter})
    if set_bpm_at_min is not None:
        db.events.append({"session_id": sid, "action": "SET_BPM", "result": "APPLIED", "target_bpm": bpm,
                          "applied_at": start + timedelta(minutes=set_bpm_at_min)})


def records_of(db, session_id):
    result = CachedDbBpmLookup(db).get_for_session(session_id)
    assert result.warning is None
    return result.bpm_input


def test_sql_text_keeps_the_rules_this_test_relies_on():
    assert "user_id = %(user_id)s" in BPM_RUNS_SQL and "status = 'COMPLETED'" in BPM_RUNS_SQL
    assert "deleted_at IS NULL" in BPM_RUNS_SQL and "ended_at IS NOT NULL" in BPM_RUNS_SQL
    assert "ORDER BY ended_at DESC" in BPM_RUNS_SQL and "LIMIT %(limit)s" in BPM_RUNS_SQL
    assert "speed >= 1.5" in BPM_WINDOWS_SQL and "cadence BETWEEN 120 AND 230" in BPM_WINDOWS_SQL
    assert "FLOOR(elapsed_duration / 60)" in BPM_WINDOWS_SQL
    assert "result = 'APPLIED'" in BPM_EVENTS_SQL and "action IN ('SET_BPM', 'COACHING')" in BPM_EVENTS_SQL


def test_only_own_completed_not_deleted_runs():
    db = MemoryBpmDb()
    run(db, 1, 7, [(2.6, 160)] * 3, day=0)                           # 본인 완료 러닝
    run(db, 2, 8, [(3.5, 185)] * 3, day=1)                           # 다른 사람
    run(db, 3, 7, [(3.4, 183)] * 3, day=2, status="RUNNING")         # 진행 중
    run(db, 4, 7, [(3.3, 181)] * 3, day=3, status="ABORTED")         # 중단
    run(db, 5, 7, [(3.2, 179)] * 3, day=4, deleted=True)             # 삭제됨
    run(db, 9, 7, [], day=5, status="RUNNING", set_bpm_at_min=None)  # 지금 세션
    recs = records_of(db, 9).records
    assert recs and {round(r.speed_mps, 1) for r in recs} == {2.6} and {r.run_no for r in recs} == {1}


def test_only_windows_with_known_bpm_and_unit_filters():
    db = MemoryBpmDb()
    # 0분: 첫 BPM 변경(0.5분) 전이라 BPM을 모름, 1분: 걷기(속도 < 1.5), 2분: 한 발 기준 케이던스(85),
    # 3분: 값 없음(null), 4분: 정상 → 4분 구간 하나만 남는다
    run(db, 1, 7, [(2.8, 170), (1.2, 140), (2.8, 85), (None, None), (2.9, 168)], set_bpm_at_min=0.5)
    run(db, 9, 7, [], day=1, status="RUNNING", set_bpm_at_min=None)
    recs = records_of(db, 9).records
    assert [(round(r.speed_mps, 2), round(r.cadence_spm), r.cue_bpm) for r in recs] == [(2.9, 168, 165.0)]


def test_not_followed_window_comes_back_but_bpm_ignores_it():
    """DB 조회는 BPM을 아는 일정 구간을 모두 주고, BPM을 따라갔는지(±5 spm)는 target_bpm.select_records가 거른다."""
    db = MemoryBpmDb()
    run(db, 1, 7, [(2.8, 170), (2.8, 170)], bpm=168.0)                # 따라감
    run(db, 2, 7, [(2.8, 150), (2.8, 150)], day=1, bpm=170.0)         # 안 따라감(차이 20)
    run(db, 9, 7, [], day=2, status="RUNNING", set_bpm_at_min=None)
    recs = records_of(db, 9).records
    assert {r.run_no for r in recs} == {1, 2}
    as_dict = [{"runNo": r.run_no, "speedMps": r.speed_mps, "cadenceSpm": r.cadence_spm, "cueBpm": r.cue_bpm}
               for r in recs]
    followed_only = [d for d in as_dict if abs(d["cadenceSpm"] - d["cueBpm"]) <= 5]
    assert expected_bpm(360, as_dict) == expected_bpm(360, followed_only)


def test_reads_recent_40_runs_and_bpm_uses_recent_20():
    db = MemoryBpmDb()
    for i in range(1, 46):                                            # 45회, 러닝마다 속도가 다르고 BPM을 따라감
        run(db, i, 7, [(2.2 + 0.03 * i, 160 + 0.3 * i)] * 2, day=i, bpm=160 + 0.3 * i)
    run(db, 99, 7, [], day=60, status="RUNNING", set_bpm_at_min=None)
    recs = records_of(db, 99).records
    assert FETCH_RUNS == 40 and len({r.run_no for r in recs}) == 40   # 가장 오래된 5회는 읽지 않는다
    newest = max(r.run_no for r in recs)
    windows = [TB.Window(r.run_no, r.speed_mps, r.cadence_spm, r.cue_bpm) for r in recs]
    used_speeds = {round(s, 2) for s, _ in TB.select_records(windows)}
    recent20 = {round(r.speed_mps, 2) for r in recs if r.run_no > newest - 20}
    assert used_speeds == recent20


def test_first_minute_uses_current_bpm_until_first_change_and_null_bpm_is_safe():
    db = MemoryBpmDb()
    run(db, 9, 7, [(2.8, 158), (2.8, 158)], status="RUNNING", current_bpm=160, set_bpm_at_min=None)
    run(db, 10, 8, [(2.8, 158)], status="RUNNING", current_bpm=None, set_bpm_at_min=None)
    assert records_of(db, 9).first_minute.cue_bpm == 160.0
    assert records_of(db, 10).first_minute.cue_bpm is None            # BPM을 모르면 큐 없는 구간처럼 다룬다


def test_api_with_db_lookup_matches_direct_target_bpm():
    db = MemoryBpmDb()
    run(db, 1, 7, [(2.7, 168), (2.9, 172)], bpm=170.0)
    run(db, 2, 7, [(3.0, 174), (3.0, 174)], day=1, bpm=175.0)
    run(db, 201, 7, [], day=2, status="RUNNING", set_bpm_at_min=None)  # decide_body의 sessionId
    recs = records_of(db, 201).records
    decision = post(decide_body(), lookup=CachedDbBpmLookup(db))["decision"]
    expected = expected_bpm(decision["recommendedPaceSecPerKm"],
                            [{"runNo": r.run_no, "speedMps": r.speed_mps, "cadenceSpm": r.cadence_spm,
                              "cueBpm": r.cue_bpm} for r in recs])
    assert decision["cueBpm"] == expected != expected_bpm(decision["recommendedPaceSecPerKm"])


@pytest.mark.parametrize("sessions", [[], [{"id": 201, "user_id": 7, "status": "RUNNING", "deleted_at": None,
                                             "ended_at": None, "current_bpm": None}]])
def test_unknown_session_or_no_records_gives_population_bpm_without_warning(sessions):
    body = post(decide_body(), lookup=CachedDbBpmLookup(MemoryBpmDb(sessions=sessions)))
    assert body["decision"]["cueBpm"] == expected_bpm(body["decision"]["recommendedPaceSecPerKm"])
    assert UNAVAILABLE_WARNING not in body["warnings"] and CUE_BPM_UNAVAILABLE not in body["warnings"]


@pytest.mark.parametrize("error", [DatabaseUnavailable("QueryCanceled", sqlstate="57014"),   # 시간 초과
                                   DatabaseUnavailable("OperationalError")])                 # DB 꺼짐
def test_slow_or_down_db_keeps_response_with_population_bpm_and_warning(error):
    body = post(decide_body(), lookup=CachedDbBpmLookup(MemoryBpmDb(fail=error)))
    assert body["decision"]["action"] == "GUIDE_PACE"
    assert body["decision"]["cueBpm"] == expected_bpm(body["decision"]["recommendedPaceSecPerKm"])
    assert UNAVAILABLE_WARNING in body["warnings"]


def test_bpm_module_failure_gives_null_and_cue_warning():
    body = post(decide_body(), cue_loader=UnavailableCueBpm)
    assert body["decision"]["cueBpm"] is None and CUE_BPM_UNAVAILABLE in body["warnings"]
    assert body["decision"]["recommendedPaceSecPerKm"] is not None


# --- 3. 끝값 ------------------------------------------------------------------

PACES = [120, 150, 180, 240, 300, 420, 600, 900, 1200, 1800, 3600]   # 2:00/km(아주 빠름) ~ 60:00/km(걷기 이하)
INPUTS = [None, {"records": RECORDS, "firstMinute": None}, {"records": [], "firstMinute": FIRST},
          {"records": [{"runNo": 1, "speedMps": 1.6, "cadenceSpm": 125.0}], "firstMinute": None},
          {"records": [{"runNo": 1, "speedMps": 6.0, "cadenceSpm": 215.0}], "firstMinute": None}]


@pytest.mark.parametrize("pace", PACES)
def test_extreme_paces_stay_integer_60_to_220(pace):
    from app.decide.schemas import BpmInput
    for bpm in INPUTS:
        got = CALC.compute(pace, BpmInput.model_validate(bpm) if bpm else None)
        assert type(got) is int and 60 <= got <= 220
        assert got == expected_bpm(pace, (bpm or {}).get("records", ()), (bpm or {}).get("firstMinute"))


def go(body, policy, calc=CALC):
    req = DecideRequest.model_validate(body)
    at = T0 + timedelta(seconds=3)
    return run_decide(req, FakeModel5(), policy, received_at=at, now=lambda: at, cue_bpm_calc=calc)


def test_every_decision_type_has_bpm():
    plan_hold = decide_body(plan=[{"startM": 0, "endM": 5000, "ratio": 1.0}], activeSec=5, distanceM=10.0,
                            routeProgressM=10.0, history={"hrBpm": [120.0], "speedMps": [2.8], "gradePct": [0.0]})
    ease_off = decide_body(history={"hrBpm": [190.0] * 80})                 # FakePolicy: 심박 185 이상이면 감속
    seen = {}
    for body in (plan_hold, decide_body(), ease_off):
        d = go(body, FakePolicy()).response.decision
        seen[d.reason if d.reason == "PLAN_HOLD" else d.action] = d.cue_bpm
    assert set(seen) == {"PLAN_HOLD", "GUIDE_PACE", "EASE_OFF"}
    assert all(type(v) is int and 60 <= v <= 220 for v in seen.values())


@pytest.mark.parametrize("anchor", [150, 240, 360, 600, 900])
@pytest.mark.parametrize("hr", [120.0, 165.0, 200.0])
def test_real_policy_decisions_always_carry_bpm(anchor, hr):
    """실제 MPC 정책으로 느린·빠른 기준 페이스와 낮은·높은 심박에서 판단이 나오면 BPM도 같이 나온다."""
    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    speed = 1000.0 / anchor
    body = decide_body(anchorPaceSecPerKm=anchor, currentGuidePaceSecPerKm=anchor,
                       history={"hrBpm": [hr] * 80, "speedMps": [speed] * 80})
    response = go(body, policy).response
    d = response.decision
    if anchor >= 900:                       # 15:00/km(약 1.1 m/s)는 걷기로 보고 판단 자체를 내지 않는다
        assert response.status == "NOT_RUNNING" and d is None
        return
    assert d is not None and d.action in {"GUIDE_PACE", "EASE_OFF"}
    assert type(d.cue_bpm) is int and 60 <= d.cue_bpm <= 220
    assert d.cue_bpm == expected_bpm(d.recommended_pace_sec_per_km)
    assert math.isfinite(d.recommended_pace_sec_per_km)
