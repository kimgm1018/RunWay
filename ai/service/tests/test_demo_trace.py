import pytest
from app.demo.trace import build_trace, check_120, mae_10min
from demo_fakes import outcome_for, mk_trace, with_check

SPEC_KEYS = {"traceId","bootId","sessionId","stage","replaySpeed","decidedAt","inputAsOf","elapsedSec","status","input",
             "reference","marginTableVersion","gate","anchorPaceSecPerKm","candidates","decision","latency","modelVersion",
             "policyVersion","stateVersion","coaching","check120","mae10MinBpm"}


def test_keys_and_id():
    t = build_trace(outcome_for(), boot_id="b7f3", seq=123, stage="L1A", replay_speed=None, grade_source="SAMPLE", previous=[])
    assert set(t) == SPEC_KEYS and t["traceId"] == "b7f3:000123" and len(t["candidates"]) == 9


@pytest.mark.parametrize("stage, delivery", [("L1A","WATCH"),("L1B","NOT_DELIVERED"),("L2","NOT_DELIVERED"),("L2B","NOT_DELIVERED"),("L3","REPLAY")])
def test_delivery_by_stage(stage, delivery):
    t = build_trace(outcome_for(), boot_id="b", seq=1, stage=stage, replay_speed=4 if stage=="L3" else None, grade_source="SAMPLE", previous=[])
    assert t["coaching"]["delivery"] == delivery


def test_input_lag_negative_kept_and_none_for_replay():
    o = outcome_for(after=-2.0)
    assert build_trace(o, boot_id="b", seq=1, stage="L2", replay_speed=None, grade_source="SAMPLE", previous=[])["latency"]["inputLagMs"] == -2000
    assert build_trace(o, boot_id="b", seq=1, stage="L3", replay_speed=1, grade_source="SAMPLE", previous=[])["latency"]["inputLagMs"] is None


def test_remaining_clamped_at_zero():
    t = build_trace(outcome_for(distanceM=5200.0), boot_id="b", seq=1, stage="L2", replay_speed=None, grade_source="SAMPLE", previous=[])
    assert t["input"]["remainingM"] == 0


def test_check_followed():
    src = mk_trace(0, 1000.0, 150); cur = mk_trace(120, 1000.0 + 120 * 1000 / 337, 160.1)
    c = check_120(cur, [src])
    assert c["shown"] == "RECOMMENDED" and c["recommended"]["errorBpm"] == 2.1 and c["comparable"] is True


def test_check_not_followed_and_out_of_range():
    src = mk_trace(0, 1000.0, 150)
    assert check_120(mk_trace(120, 1000.0 + 120 * 1000 / 351, 160), [src])["shown"] == "NEAREST"
    c = check_120(mk_trace(120, 1000.0 + 120 * 1000 / 362, 160), [src])
    assert c["shown"] is None and c["comparable"] is False and c["notComparableReason"] == "OUT_OF_CANDIDATE_RANGE"


def test_check_no_source_and_ease_off_source():
    assert check_120(mk_trace(120, 1300.0, 160), [mk_trace(-15, 1000.0, 150)])["notComparableReason"] == "NO_SOURCE_TRACE"
    c = check_120(mk_trace(120, 1000.0 + 120 * 1000 / 340, 160), [mk_trace(0, 1000.0, 150, chosen=None)])
    assert c["recommended"] is None and c["shown"] == "NEAREST"


def test_mae_excludes_not_comparable_and_old():
    prev = [with_check(mk_trace(-700, 0, 150), 10.0), with_check(mk_trace(-300, 0, 150), 2.0),
            with_check(mk_trace(-60, 0, 150), -4.0), with_check(mk_trace(-30, 0, 150), None)]
    assert mae_10min(with_check(mk_trace(0, 0, 150), None), prev) == 3.0
