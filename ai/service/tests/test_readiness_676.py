"""S15P31E105-676 준비도 민감도 c: 플래그 끔 동일성, R 없음·R≥70 변화 없음, clip·상한, 섞기 비중, AI10 회원별, AI06 c 복원, AI09."""
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import readiness_adjust as ra
from app import target_calibration
from app.db_lookup import HR_THRESHOLD_SQL
from app.hr_threshold_lookup import CachedDbHrThresholdLookup, HrThresholdLookupResult
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.hr_reference import blend_hr_thresholds
from app.policy.mpc_policy import MpcPolicy, allow_at
from demo_fakes import T0, FakeModel5, decide_body, fixed_clock, flat_table
from test_gru_gb_641 import GroupModel, _fake_model, _member

TODAY = date(2026, 11, 5)          # T0(05:16 UTC)의 서울 날짜


# ---------------------------------------------------------------- 식
def test_no_change_without_score_or_when_ready():
    for score in (None, 70, 82, 100, "abc", 101, -1, float("nan"), True):
        assert ra.adjustment(score).drop_bpm == 0.0
    assert ra.adjustment(82, c_user=0.4, n=100).drop_bpm == 0.0


def test_new_user_uses_prior_and_examples():
    assert ra.adjustment(45).drop_bpm == pytest.approx(3.75)        # 0.15 × 25
    assert ra.adjustment(45).weight == 0.0
    assert ra.adjustment(69).drop_bpm == pytest.approx(0.15)
    assert ra.adjustment(Decimal("60.5")).drop_bpm == pytest.approx(0.15 * 9.5)


def test_blend_weight_is_n_over_n_plus_k():
    adj = ra.adjustment(45, c_user=0.35, n=10)
    assert adj.weight == pytest.approx(0.5)
    assert adj.sensitivity == pytest.approx(0.25)
    assert adj.drop_bpm == pytest.approx(6.0)                       # 0.25 × 25 = 6.25 → 상한 6
    assert ra.adjustment(45, c_user=0.0, n=30).drop_bpm == pytest.approx(0.25 * 0.15 * 25)
    assert ra.adjustment(45, c_user="0.0", n="30").weight == pytest.approx(0.75)   # ->>는 text
    # 잘못된 저장값은 사전값
    for c_user, n in ((0.5, 10), (-0.1, 10), ("x", 10), (0.3, -1), (0.3, 1.5), (0.3, 0)):
        adj = ra.adjustment(45, c_user=c_user, n=n)
        assert (adj.weight, adj.sensitivity) == (0.0, ra.C_PRIOR)


def test_clip_and_caps():
    assert ra.adjustment(0, c_user=0.4, n=10_000).drop_bpm == 6.0
    assert ra.adjustment(45, c_user=0.0, n=10_000).drop_bpm == pytest.approx(0.15 * 25 * 10 / 10_010)
    assert ra.fit_sensitivity([10.0, 10.0], [1.0, 1.0]) == 0.4      # 원값 10 → 0.4
    assert ra.fit_sensitivity([-3.0], [5.0]) == 0.0                 # 음수 → 0(더 보수적으로만)
    assert ra.fit_sensitivity([1.0, 2.0], [0.0, 0.0]) is None       # 낮은 준비도 날 없음
    assert ra.ratio_drop(6.0, 150.0) == 0.02                        # 4% → 2%
    assert ra.ratio_drop(1.5, 150.0) == pytest.approx(0.01)
    assert ra.ratio_drop(0.0, 150.0) == 0.0


def test_lower_thresholds_moves_allow_line_by_exactly_drop():
    cfg = load_policy_config()
    ref = blend_hr_thresholds(cfg, personal_danger_bpm=188.0, personal_sustain_bpm=168.0, run_count=5)
    assert ra.lower_thresholds(ref, 0.0) is ref
    low = ra.lower_thresholds(ref, 3.75)
    for p in (0.0, 0.3, 0.6, 0.9, 1.0):
        assert allow_at(p, low, cfg) == pytest.approx(allow_at(p, ref, cfg) - 3.75)
    assert low.danger_bpm == pytest.approx(ref.danger_bpm - 3.75)
    assert (low.source, low.weight, low.run_count) == (ref.source, ref.weight, ref.run_count)


def test_session_day_is_seoul_date():
    assert ra.session_day(datetime(2026, 11, 10, 15, 30, tzinfo=timezone.utc)) == date(2026, 11, 11)
    assert ra.session_day(datetime(2026, 11, 10, 14, 59, tzinfo=timezone.utc)) == date(2026, 11, 10)


# ---------------------------------------------------------------- 조회
class ReadinessDb:
    def __init__(self, scores, fail=False):
        self.scores, self.fail, self.calls = scores, fail, []

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self.calls.append((sql, params))
        if self.fail:
            raise TimeoutError
        score = self.scores.get(params["user_id"])
        return None if score is None else {"readiness_score": score}

    def fetch_all(self, sql, params):
        return [{"readiness_date": day, "readiness_score": self.scores.get(day)} for day in params["days"]
                if day in self.scores]


def test_lookup_caches_per_user_day_and_failure_means_no_change():
    db = ReadinessDb({7: Decimal("45.00")})
    lookup = ra.CachedReadinessLookup(db)
    assert lookup.score_for(7, TODAY) == (45.0, None)
    assert lookup.score_for(7, TODAY) == (45.0, None)
    assert len(db.calls) == 1 and db.calls[0][0] == ra.READINESS_SQL
    assert db.calls[0][1] == {"user_id": 7, "day": TODAY}
    assert lookup.score_for(8, TODAY) == (None, None)
    adjust, warnings = ra.user_adjustment(ra.CachedReadinessLookup(ReadinessDb({}, fail=True)), 7, T0)
    assert adjust.drop_bpm == 0.0 and warnings == (ra.UNAVAILABLE_WARNING,)
    assert ra.user_adjustment(None, 7, T0) == (ra.NO_ADJUSTMENT, ())


def test_threshold_row_reads_sensitivity_from_same_query():
    class Db:
        def fetch_one_with_timeout(self, sql, params, timeout_ms):
            return {"hr_danger_bpm": 195, "hr_sustain_bpm": 180, "hr_threshold_run_count": 2,
                    "readiness_sensitivity": "0.21", "readiness_support_n": "12"}
    result = CachedDbHrThresholdLookup(Db()).get_for_user(7)
    assert (result.readiness_sensitivity, result.readiness_support_n) == (0.21, 12)
    assert "summary_u_json->>'readinessSensitivity'" in HR_THRESHOLD_SQL


# ---------------------------------------------------------------- AI04
class Row:
    def __init__(self, c_user=None, n=0):
        self.result = HrThresholdLookupResult(190.0, 170.0, 2, readiness_sensitivity=c_user, readiness_support_n=n)

    def get_for_user(self, _user_id):
        return self.result


class FixedReadiness:
    def __init__(self, scores):
        self.scores = scores

    def score_for(self, user_id, day):
        assert day == TODAY
        return self.scores.get(user_id), None


def _ai04(monkeypatch, flag, readiness, row=None):
    if flag is None:
        monkeypatch.delenv("READINESS_ADJUST_ENABLED", raising=False)
    else:
        monkeypatch.setenv("READINESS_ADJUST_ENABLED", flag)
    body = decide_body()
    body["userId"] = 73
    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    with TestClient(create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock(3.0),
                               hr_threshold_lookup=row or Row(), readiness_lookup=readiness)) as client:
        response = client.post("/v1/pace/decide", json=body)
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("flag", [None, "false", "0"])
def test_ai04_flag_off_is_bit_identical_even_with_low_readiness(monkeypatch, flag):
    base = _ai04(monkeypatch, flag, None)
    low = _ai04(monkeypatch, flag, FixedReadiness({73: 20.0}), Row(0.4, 50))
    assert low == base
    assert "readinessAdjustBpm" not in base["pacing"]


@pytest.mark.parametrize("score", [None, 70.0, 82.0])
def test_ai04_missing_or_ready_score_changes_nothing_but_display(monkeypatch, score):
    base = _ai04(monkeypatch, None, None)
    on = _ai04(monkeypatch, "true", FixedReadiness({73: score}))
    extra = {k: on["pacing"].pop(k) for k in ("readinessScore", "readinessAdjustBpm", "readinessWeight")
             if k in on["pacing"]}
    assert on == base
    assert extra["readinessAdjustBpm"] == 0.0 and extra.get("readinessScore") == score


def test_ai04_low_readiness_lowers_both_lines(monkeypatch):
    base = _ai04(monkeypatch, None, None)
    on = _ai04(monkeypatch, "true", FixedReadiness({73: 45.0}))
    assert on["pacing"]["readinessAdjustBpm"] == pytest.approx(3.75)
    assert on["pacing"]["readinessWeight"] == 0.0 and on["pacing"]["readinessScore"] == 45.0
    assert on["pacing"]["hrSustainBpm"] == pytest.approx(base["pacing"]["hrSustainBpm"] - 3.75)
    assert on["pacing"]["hrDangerBpm"] == pytest.approx(base["pacing"]["hrDangerBpm"] - 3.75)
    for c_on, c_off in zip(on["candidates"], base["candidates"]):
        assert c_on["predHrBpm"] == c_off["predHrBpm"]                      # 예측은 그대로, 허용선만 낮아짐


# ---------------------------------------------------------------- AI10 회원별
def _ai10(readiness, table=None):
    from app.group_pace.schemas import GroupPaceRequest
    from app.group_pace.service import recommend_group_pace

    class PerUser:
        def get_for_user(self, user_id):
            c_user, n = (table or {}).get(int(user_id), (None, 0))
            return HrThresholdLookupResult(190.0, 170.0, 2, readiness_sensitivity=c_user, readiness_support_n=n)

    body = {"groupRunId": 3, "currentGroupPaceSecPerKm": 340, "goalPaceSecPerKm": 320,
            "startRecommendedPaceSecPerKm": None, "elapsedSec": 300, "now": T0.isoformat(), "lastChange": None,
            "participants": [_member(1, 150.0), _member(2, 160.0), _member(3, 140.0)]}
    detail = {}
    response = recommend_group_pace(GroupPaceRequest.model_validate(body), GroupModel(),
                                    MpcPolicy(load_policy_config(), flat_table(0.0)),
                                    hr_threshold_lookup=PerUser(), detail=detail, readiness_lookup=readiness)
    return response, detail["members"]


def test_ai10_moves_only_the_low_readiness_members_line():
    _resp_off, off = _ai10(None)
    _resp_on, on = _ai10(FixedReadiness({1: 45.0, 2: None, 3: 90.0}), {1: (0.35, 10)})
    assert on[0]["allow"] == pytest.approx(off[0]["allow"] - 6.0)        # c = 0.25 → 6.25 → 상한 6
    assert on[1]["allow"] == off[1]["allow"] and on[2]["allow"] == off[2]["allow"]
    assert on[0]["readiness"] == {"score": 45.0, "adjustBpm": 6.0, "weight": 0.5}
    assert on[1]["readiness"]["adjustBpm"] == 0.0
    assert "readiness" not in off[0]
    for a, b in zip(on, off):
        assert a["pred"] == b["pred"]


def test_ai10_flag_off_is_bit_identical():
    resp_a, a = _ai10(None)
    resp_b, b = _ai10(None, {1: (0.4, 99)})
    assert resp_a == resp_b and a == b


# ---------------------------------------------------------------- AI06 c 복원
def test_ai06_fit_recovers_known_sensitivity(monkeypatch):
    import app.gru_personalization as gp
    import pandas as pd

    rng = np.random.default_rng(7)
    c_true, gain, offset = 0.22, 0.9, 1.5
    per_run, sessions, scores = {}, [], {}
    for sid in range(1, 25):
        day = date(2026, 10, sid)
        score = float(rng.uniform(30, 95))
        x = rng.normal(scale=5.0, size=(40, 3))
        y = gain * x + offset + c_true * max(0.0, 70 - score) + rng.normal(scale=1.0, size=(40, 3))
        per_run[sid] = (x, y)
        sessions.append(SimpleNamespace(session_id=sid,
                                        session_started_at=datetime(2026, 10, sid, 0, 0, tzinfo=timezone.utc)))
        if sid != 24:                     # 마지막 런은 준비도 없음 → n에서 빠진다
            scores[day] = score
    monkeypatch.setattr(gp, "support_to_frames", lambda body: [pd.DataFrame({"session_id": [s.session_id]})
                                                               for s in body.sessions])
    body = SimpleNamespace(user_id=73, sessions=sessions)
    lookup = ra.CachedReadinessLookup(ReadinessDb(scores))
    out = ra.compute_sensitivity(_fake_model(per_run), body, lookup, gain=gain, offset=offset)
    assert out[ra.SUPPORT_KEY] == 23
    assert out[ra.SENSITIVITY_KEY] == pytest.approx(c_true, abs=0.01)
    # 저장 키를 읽는 쪽 검증을 통과한다.
    assert ra.adjustment(45, str(out[ra.SENSITIVITY_KEY]), str(out[ra.SUPPORT_KEY])).weight == pytest.approx(23 / 33)


def test_ai06_summary_untouched_when_lookup_missing_and_prior_without_low_days(monkeypatch):
    import app.gru_personalization as gp
    import pandas as pd

    result = {"summaryU": {"hr_ref": 150.0}}
    ra.add_sensitivity_to_summary(result, SimpleNamespace(), object(), None, gb_enabled=False)
    assert result == {"summaryU": {"hr_ref": 150.0}}
    monkeypatch.setattr(gp, "support_to_frames", lambda body: [pd.DataFrame({"session_id": [1]})])
    body = SimpleNamespace(user_id=73, sessions=[SimpleNamespace(
        session_id=1, session_started_at=datetime(2026, 10, 1, tzinfo=timezone.utc))])
    model = _fake_model({1: (np.zeros((10, 3)), np.ones((10, 3)))})
    ra.add_sensitivity_to_summary(result, body, model, ra.CachedReadinessLookup(ReadinessDb({date(2026, 10, 1): 90})),
                                  gb_enabled=False)
    assert result["summaryU"] == {"hr_ref": 150.0, ra.SENSITIVITY_KEY: ra.C_PRIOR, ra.SUPPORT_KEY: 1}


# ---------------------------------------------------------------- AI09
def test_ai09_target_ratio_drop_capped_at_two_percent():
    cfg = load_policy_config()
    ref = blend_hr_thresholds(cfg)
    plain = SimpleNamespace(target_hr_history_median_bpm=None, target_hr_history_run_count=0)
    base = target_calibration.calibrate_reference(ref, plain)
    assert target_calibration.calibrate_reference(
        ref, SimpleNamespace(**vars(plain), readiness_drop_bpm=0.0)).sustain_bpm == base.sustain_bpm
    small = target_calibration.calibrate_reference(ref, SimpleNamespace(**vars(plain), readiness_drop_bpm=1.0))
    assert small.sustain_bpm == pytest.approx(base.sustain_bpm - 1.0)
    big = target_calibration.calibrate_reference(ref, SimpleNamespace(**vars(plain), readiness_drop_bpm=6.0))
    assert big.sustain_bpm == pytest.approx(base.sustain_bpm - 0.02 * ref.sustain_bpm)
    assert big.danger_bpm == base.danger_bpm
    # 경고는 기능이 켜져 오늘 R이 있을 때만 붙는다.
    assert target_calibration.calibration_warnings(plain) == target_calibration.calibration_warnings(
        SimpleNamespace(**vars(plain), readiness_score=None, readiness_drop_bpm=0.0))
    assert "READINESS_ADJUST_BPM=3.75" in target_calibration.calibration_warnings(
        SimpleNamespace(**vars(plain), readiness_score=45.0, readiness_drop_bpm=3.75))


def test_code_default_flag_is_off(monkeypatch):
    monkeypatch.delenv("READINESS_ADJUST_ENABLED", raising=False)
    assert ra.readiness_enabled() is False
