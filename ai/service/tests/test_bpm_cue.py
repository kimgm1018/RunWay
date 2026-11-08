"""AI04 목표 BPM(cueBpm) 연결: ai/bpm/target_bpm.py를 그대로 쓰는지와 예외 처리를 확인한다."""
from datetime import datetime, timedelta, timezone

import pytest

from app.bpm_cue import CUE_BPM_UNAVAILABLE, CueBpmCalculator, UnavailableCueBpm
from app.decide.schemas import BpmInput, DecideRequest
from app.decide.service import run_decide
from demo_fakes import FakeModel5, FakePolicy, decide_body

T0 = datetime(2026, 11, 5, 5, 16, 35, tzinfo=timezone.utc)
CALC = CueBpmCalculator()
tb = CALC._tb            # 기대값도 같은 ai/bpm 함수로 만든다


def bpm_input(**kw):
    return BpmInput.model_validate(kw)


def go(body, calc=CALC):
    req = DecideRequest.model_validate(body)
    at = T0 + timedelta(seconds=3)
    return run_decide(req, FakeModel5(), FakePolicy(), received_at=at, now=lambda: at, cue_bpm_calc=calc)


def test_new_user_uses_population_line():
    expected = tb.target_bpm(360, CALC.prior).bpm
    assert CALC.compute(360, None) == expected
    assert CALC.compute(360, bpm_input(records=[])) == expected
    assert 60 <= expected <= 220 and isinstance(expected, int)


def test_first_minute_changes_bpm_once_when_followed():
    base = tb.target_bpm(360, CALC.prior).bpm
    first = {"speedMps": 2.78, "cadenceSpm": base - 8, "cueBpm": base - 6}    # 따라감(차이 2), 평소보다 낮은 박자
    got = CALC.compute(360, bpm_input(firstMinute=first))
    assert got != base and abs(got - base) >= 3
    assert CALC.compute(360, bpm_input(firstMinute=first)) == got            # 다시 불러도 같다(누적·반복 없음)


def test_first_minute_ignored_when_not_followed():
    base = tb.target_bpm(360, CALC.prior).bpm
    first = {"speedMps": 2.78, "cadenceSpm": base - 12, "cueBpm": base}       # 박자를 안 따라감(차이 12)
    assert CALC.compute(360, bpm_input(firstMinute=first)) == base


def test_first_minute_keeps_working_after_pace_change():
    first = {"speedMps": 2.78, "cadenceSpm": 158, "cueBpm": 160}
    for pace in (360, 330):
        expected = tb.first_minute_bpm(tb.target_bpm(pace, CALC.prior).bpm, pace,
                                       tb.Window(0, 2.78, 158, 160), [], CALC.prior)
        got = CALC.compute(pace, bpm_input(firstMinute=first))
        assert got == (expected.bpm if expected else tb.target_bpm(pace, CALC.prior).bpm)


def test_records_user_uses_recent_followed_records_and_skips_first_minute():
    rows = [{"runNo": r, "speedMps": 2.8, "cadenceSpm": 170.0, "cueBpm": None} for r in range(1, 4)]
    rows.append({"runNo": 4, "speedMps": 2.8, "cadenceSpm": 150.0, "cueBpm": 170.0})   # 안 따라간 구간은 빠진다
    inp = bpm_input(records=rows, firstMinute={"speedMps": 3.2, "cadenceSpm": 150.0, "cueBpm": 150.0})
    windows = [tb.Window(r["runNo"], r["speedMps"], r["cadenceSpm"], r["cueBpm"]) for r in rows]
    expected = tb.target_bpm(360, CALC.prior, records=tb.select_records(windows)).bpm
    assert CALC.compute(360, inp) == expected


def test_decide_puts_integer_bpm_in_decision():
    d = go(decide_body()).response.decision
    assert d.cue_bpm == tb.target_bpm(d.recommended_pace_sec_per_km, CALC.prior).bpm
    assert isinstance(d.cue_bpm, int)


def test_decide_reads_bpm_context_in_camel_case():
    body = decide_body(bpm={"records": [{"runNo": 1, "speedMps": 2.9, "cadenceSpm": 176.0, "cueBpm": None}],
                            "firstMinute": None})
    d = go(body).response.decision
    rec = tb.select_records([tb.Window(1, 2.9, 176.0)])
    assert d.cue_bpm == tb.target_bpm(d.recommended_pace_sec_per_km, CALC.prior, records=rec).bpm


def test_plan_hold_also_gets_bpm():
    body = decide_body(plan=[{"startM": 0, "endM": 5000, "ratio": 1.0}], activeSec=5, distanceM=10.0,
                       routeProgressM=10.0, history={"hrBpm": [120.0], "speedMps": [2.8], "gradePct": [0.0]})
    o = go(body)
    assert o.response.decision.reason == "PLAN_HOLD"
    assert o.response.decision.cue_bpm == tb.target_bpm(o.response.decision.recommended_pace_sec_per_km,
                                                        CALC.prior).bpm


def test_failure_gives_null_and_warning_not_a_fixed_bpm():
    o = go(decide_body(), calc=UnavailableCueBpm())
    assert o.response.decision.cue_bpm is None
    assert CUE_BPM_UNAVAILABLE in o.response.warnings
    assert o.response.decision.action == "GUIDE_PACE"          # 페이스 코칭은 계속한다


def test_no_calculator_keeps_old_response():
    o = go(decide_body(), calc=None)
    assert o.response.decision.cue_bpm is None and CUE_BPM_UNAVAILABLE not in o.response.warnings


def test_bpm_context_rejects_bad_values():
    with pytest.raises(ValueError):
        bpm_input(records=[{"runNo": 0, "speedMps": 2.8, "cadenceSpm": 170}])
    with pytest.raises(ValueError):
        bpm_input(firstMinute={"speedMps": -1, "cadenceSpm": 170})
