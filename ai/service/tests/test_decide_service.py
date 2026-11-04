from datetime import datetime, timedelta, timezone
import pytest
from app.decide.schemas import DecideRequest
from app.decide.service import run_decide, recent_inputs
from demo_fakes import decide_body, FakeModel5, FakePolicy
T0 = datetime(2026, 11, 5, 5, 16, 35, tzinfo=timezone.utc)


def go(body=None, policy=None, after=3.0, model=None):
    req = DecideRequest.model_validate(body or decide_body())
    at = T0 + timedelta(seconds=after)
    return run_decide(req, model or FakeModel5(), policy or FakePolicy(), received_at=at, now=lambda: at)


def test_paused_skips_model_and_policy():
    m, p = FakeModel5(), FakePolicy()
    o = go(decide_body(runState="PAUSED"), p, model=m)
    assert o.status == "PAUSED" and o.response.decision is None and m.batches == [] and p.calls == []


def test_stale_input_is_insufficient():
    assert go(after=20.0).status == "INPUT_INSUFFICIENT" and go(after=20.0).error.status == 422
    assert go(after=19.9).status == "HR_STALE"          # 15~20초: 판단은 하되 가속만 막는다(가짜 정책도 같은 경계)
    assert go(after=15.0).status == "OK"


def test_guide_pace_maps_to_coaching_columns():
    o = go()
    d = o.response.decision
    assert d.chosen_index == 2 and d.predicted_hr_120_bpm == o.pred_hr[2][2]
    assert d.based_on_state_version == 7 and d.route_progress_m == 2310.0
    assert d.expires_at == T0 + timedelta(seconds=20)


def test_ease_off_has_no_prediction():
    hr = [150.0] * 77 + [186.0] * 3
    d = go(decide_body(history={"hrBpm": hr})).response.decision
    assert d.action == "EASE_OFF" and d.chosen_index is None and d.predicted_hr_30_bpm is None


def test_policy_outputs_pass_through():
    assert go(policy=FakePolicy(publish=False)).response.publish_suggested is False
    r = go(policy=FakePolicy(publish=True)).response
    assert r.publish_suggested is True and r.warnings == [] and r.pacing.eta_sec is None


def test_recent_cells_and_candidate_fields():
    p = FakePolicy(); go(policy=p)
    inp = p.calls[-1]
    assert len(inp.recent_cells) == 12 and inp.recent_cells[-1] == (150.0, 3.0)
    assert [c.delta_sec_per_km for c in inp.candidates] == [-10, -5, 0, 5, 10]
    assert inp.candidates[0].future_speed_mps == pytest.approx(1000 / 330)


def test_policy_error_is_decision_failed():
    from app.inference import ApiError
    with pytest.raises(ApiError) as e: go(policy=FakePolicy(raise_error=True))
    assert e.value.code == "DECISION_FAILED" and e.value.status == 500


def test_policy_input_age_and_recent():
    p = FakePolicy(); go(policy=p, after=3.0)
    assert p.calls[-1].input_age_sec == 3.0
    assert recent_inputs(DecideRequest.model_validate(decide_body()).history)[2] == 1000 / 3.0
