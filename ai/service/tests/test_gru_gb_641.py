"""S15P31E105-641 ODE식 GRU 개인 g·b: 플래그 끔 동일성, 키 없음·잘못된 값, clip, AI10 회원별, AI06 summaryU."""
from decimal import Decimal
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient

from app import gru_gb
from app.db_lookup import HR_THRESHOLD_SQL
from app.hr_threshold_lookup import CachedDbHrThresholdLookup, HrThresholdLookupResult
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import FakeModel5, FakePolicy, decide_body, fixed_clock, flat_table
from test_gru_personalization import app_client, personalize_body, real_gru, support_session  # noqa: F401

HR0 = 150.0


# ---------------------------------------------------------------- 검증·적용·clip
@pytest.mark.parametrize("gain, offset", [
    (None, None), ("0.9", None), (None, "1.0"), ("abc", "1.0"), (True, 0.0), (float("nan"), 0.0),
    (0.49, 0.0), (2.01, 0.0), (1.0, 8.01), (1.0, -8.5), ("inf", "0"), ({}, []),
])
def test_missing_or_invalid_stored_values_mean_no_correction(gain, offset):
    assert gru_gb.parse_gb(gain, offset) == (1.0, 0.0)


def test_valid_stored_values_are_read_from_text_or_numbers():
    assert gru_gb.parse_gb("0.974", "0.05") == (0.974, 0.05)       # ->> 연산자는 text를 돌려준다
    assert gru_gb.parse_gb(Decimal("2.0"), -8) == (2.0, -8.0)
    assert gru_gb.parse_gb(0.5, 8.0) == (0.5, 8.0)


def test_apply_identity_returns_same_array_and_formula_otherwise():
    pred = np.array([[160.0, 165.0, 170.0], [151.0, 152.0, 149.0]])
    assert gru_gb.apply_gb(pred, HR0, 1.0, 0.0) is pred
    assert gru_gb.apply_gb(pred, None, 0.8, 2.0) is pred
    out = gru_gb.apply_gb(pred, HR0, 0.8, 2.0)
    assert np.allclose(out, HR0 + 0.8 * (pred - HR0) + 2.0)


def test_fit_clips_raw_gain_and_offset_then_shrinks_toward_identity():
    x = np.linspace(-10, 10, 50)
    assert gru_gb.fit_gb(x, 3.0 * x + 1.0) == (2.0, pytest.approx(1.0))     # g 3 → 2.0
    assert gru_gb.fit_gb(x, 0.1 * x) == (0.5, pytest.approx(0.0))           # g 0.1 → 0.5
    assert gru_gb.fit_gb(x, x + 20.0)[1] == 8.0                             # b 20 → 8
    assert gru_gb.fit_gb(x, x - 20.0)[1] == -8.0
    assert gru_gb.fit_gb(np.ones(10), np.arange(10.0)) == (1.0, 0.0)        # x 분산 0
    assert gru_gb.fit_gb(np.array([1.0]), np.array([2.0])) == (1.0, 0.0)
    g, b = gru_gb.shrink_gb(2.0, 8.0, 50)                                   # n = k → 절반
    assert (g, b) == (1.5, 4.0)
    assert gru_gb.shrink_gb(0.5, -8.0, 0) == (1.0, 0.0)
    # 631 fit_gb(np.polyfit)와 같은 닫힌 해
    rng = np.random.default_rng(0)
    x = rng.normal(size=300)
    y = 0.93 * x + 0.4 + rng.normal(scale=0.5, size=300)
    assert np.allclose(gru_gb.fit_gb(x, y), np.polyfit(x, y, 1))


# ---------------------------------------------------------------- 같은 행 조회
class FakeDb:
    def __init__(self, row):
        self.row, self.calls = row, []

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self.calls.append(sql)
        return self.row


def test_threshold_row_carries_gb_from_same_query():
    row = {"hr_danger_bpm": Decimal("195"), "hr_sustain_bpm": Decimal("180"), "hr_threshold_run_count": 2,
           "gru_gain": "0.95", "gru_offset_bpm": "0.3"}
    db = FakeDb(row)
    result = CachedDbHrThresholdLookup(db).get_for_user(7)
    assert (result.gru_gain, result.gru_offset_bpm) == (0.95, 0.3)
    assert len(db.calls) == 1 and db.calls[0] == HR_THRESHOLD_SQL
    assert "summary_u_json->>'gruGain'" in HR_THRESHOLD_SQL and "summary_u_json->>'gruOffsetBpm'" in HR_THRESHOLD_SQL


def test_threshold_row_without_gb_keys_falls_back_to_identity():
    row = {"hr_danger_bpm": Decimal("195"), "hr_sustain_bpm": Decimal("180"), "hr_threshold_run_count": 2}
    result = CachedDbHrThresholdLookup(FakeDb(row)).get_for_user(7)
    assert (result.gru_gain, result.gru_offset_bpm) == (1.0, 0.0)
    assert result.hr_danger_bpm == 195.0
    bad = dict(row, gru_gain="7", gru_offset_bpm="0.3")
    assert CachedDbHrThresholdLookup(FakeDb(bad)).get_for_user(7).gru_gain == 1.0


def test_gb_is_kept_when_thresholds_are_empty():
    row = {"hr_danger_bpm": None, "hr_sustain_bpm": None, "hr_threshold_run_count": 0,
           "gru_gain": "1.02", "gru_offset_bpm": "-0.1"}
    result = CachedDbHrThresholdLookup(FakeDb(row)).get_for_user(7)
    assert not result.has_thresholds and (result.gru_gain, result.gru_offset_bpm) == (1.02, -0.1)


# ---------------------------------------------------------------- AI04
class SpyPolicy(MpcPolicy):
    def __init__(self):
        super().__init__(load_policy_config(), flat_table(0.0))
        self.inputs = []

    def decide(self, inp):
        self.inputs.append(inp)
        return super().decide(inp)


class GbRow:
    def __init__(self, gain, offset, danger=190.0, sustain=170.0):
        self.result = HrThresholdLookupResult(danger, sustain, 2, gru_gain=gain, gru_offset_bpm=offset)

    def get_for_user(self, _user_id):
        return self.result


def _ai04(monkeypatch, flag, lookup, *, hr_last=HR0):
    if flag is None:
        monkeypatch.delenv("GRU_GB_PERSONALIZATION_ENABLED", raising=False)
    else:
        monkeypatch.setenv("GRU_GB_PERSONALIZATION_ENABLED", flag)
    policy = SpyPolicy()
    body = decide_body(history={"hrBpm": [HR0] * 79 + [hr_last], "speedMps": [2.5] * 80, "gradePct": [0.0] * 80})
    body["userId"] = 73
    with TestClient(create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock(3.0),
                               hr_threshold_lookup=lookup)) as client:
        response = client.post("/v1/pace/decide", json=body)
    assert response.status_code == 200
    inp = policy.inputs[-1]
    rows = [c.pred_hr_bpm for c in inp.candidates] + [r.pred_hr_bpm for r in inp.slow_rows]
    if inp.actual_pred_hr_bpm is not None:
        rows.append(inp.actual_pred_hr_bpm)
    return response.json(), np.asarray(rows)


@pytest.mark.parametrize("flag", [None, "false", "0"])
def test_ai04_flag_off_is_bit_identical_even_with_stored_gb(monkeypatch, flag):
    base_json, base_rows = _ai04(monkeypatch, flag, GbRow(1.0, 0.0))
    json_gb, rows_gb = _ai04(monkeypatch, flag, GbRow(0.7, 5.0))
    assert rows_gb.tobytes() == base_rows.tobytes()
    assert json_gb == base_json


def test_ai04_flag_on_with_missing_keys_is_identical_to_off(monkeypatch):
    _off_json, off_rows = _ai04(monkeypatch, None, GbRow(1.0, 0.0))
    _on_json, on_rows = _ai04(monkeypatch, "true", GbRow(1.0, 0.0))      # 키 없음 = (1, 0)
    assert on_rows.tobytes() == off_rows.tobytes()
    _broken_json, broken_rows = _ai04(monkeypatch, "true", BrokenLookup())
    assert broken_rows.tobytes() == off_rows.tobytes()


class BrokenLookup:
    def get_for_user(self, _user_id):
        raise TimeoutError


def test_ai04_flag_on_applies_gb_to_every_gru_row_around_t0_hr(monkeypatch):
    _off, off_rows = _ai04(monkeypatch, None, GbRow(1.0, 0.0), hr_last=152.0)
    on_json, on_rows = _ai04(monkeypatch, "true", GbRow(0.8, 2.0), hr_last=152.0)
    # 기준은 GRU hr0 = 마지막 칸(152), 최근 3칸 평균이 아니다.
    assert np.allclose(on_rows, 152.0 + 0.8 * (off_rows - 152.0) + 2.0)
    assert len(on_rows) > len(on_json["candidates"])                       # 실측·감속 행도 함께 보정
    assert on_json["candidates"][0]["predHrBpm"] == pytest.approx(list(on_rows[0]))


# ---------------------------------------------------------------- AI10 회원별
class GroupModel:
    from app.models.base import ModelInfo
    info = ModelInfo("gru", "group-test", 360, 1)

    def predict(self, batch):
        hr = batch["hr"][:, -1]
        pace = 1000.0 / batch["future_speed"][:, 0]
        return np.stack([hr + (340 - pace) * k for k in (0.1, 0.2, 0.4)], axis=1) + 5.0


class PerUser:
    def __init__(self, table):
        self.table = table

    def get_for_user(self, user_id):
        gain, offset = self.table.get(int(user_id), (1.0, 0.0))
        return HrThresholdLookupResult(190.0, 170.0, 2, gru_gain=gain, gru_offset_bpm=offset)


def _member(user_id, hr):
    return {"userId": user_id, "active": True,
            "history": {"hrBpm": [hr] * 12, "speedMps": [1000 / 340] * 12, "gradePct": [0.0] * 12},
            "futureGradePct": None}


def _ai10(table, enabled):
    from app.group_pace.schemas import GroupPaceRequest
    from app.group_pace.service import recommend_group_pace
    from demo_fakes import T0

    body = {"groupRunId": 3, "currentGroupPaceSecPerKm": 340, "goalPaceSecPerKm": 320,
            "startRecommendedPaceSecPerKm": None, "elapsedSec": 300, "now": T0.isoformat(), "lastChange": None,
            "participants": [_member(1, 150.0), _member(2, 160.0), _member(3, 140.0)]}
    detail = {}
    response = recommend_group_pace(GroupPaceRequest.model_validate(body), GroupModel(),
                                    MpcPolicy(load_policy_config(), flat_table(0.0)),
                                    hr_threshold_lookup=PerUser(table), detail=detail, gru_gb_enabled=enabled)
    return response, np.asarray([m["pred"] for m in detail["members"]])


def test_ai10_applies_each_members_own_gb():
    table = {1: (0.8, 2.0), 2: (1.2, -3.0)}                             # 3번은 키 없음
    _resp_off, off = _ai10(table, False)
    _resp_on, on = _ai10(table, True)
    assert np.allclose(on[0], 150.0 + 0.8 * (off[0] - 150.0) + 2.0)
    assert np.allclose(on[1], 160.0 + 1.2 * (off[1] - 160.0) - 3.0)
    assert on[2].tobytes() == off[2].tobytes()


def test_ai10_flag_off_is_bit_identical_with_stored_gb():
    resp_plain, plain = _ai10({}, False)
    resp_gb, with_gb = _ai10({1: (0.6, 7.0), 2: (1.9, -7.0), 3: (0.9, 1.0)}, False)
    assert with_gb.tobytes() == plain.tobytes()
    assert resp_gb == resp_plain


# ---------------------------------------------------------------- AI06
class FakePredictor:
    """support_features가 (특징, 정규화 정답 변화량, 채점 가능)을 돌려주는 가짜. head는 _fake_model에서 단위 행렬."""
    std = np.array([1.0, 1.0, 2.0], np.float32)

    def __init__(self, per_run, grade_runs=None):
        self.per_run = per_run                     # session_id → (x_bpm [n,3], y_bpm [n,3])
        self.grade_runs = grade_runs
        self.models = {"main": None, "nograde": None}
        self.calls = []

    def support_features(self, frames, key):
        sid = int(frames[0].session_id.iloc[0])
        self.calls.append((sid, key))
        if key == "main" and self.grade_runs is not None and sid not in self.grade_runs:
            return None
        x, y = self.per_run[sid]
        # head(단위 행렬) 출력 × std(2) = x, 정답 × std(2) = y
        return _Features(torch.as_tensor(x / 2.0, dtype=torch.float32), torch.as_tensor(y / 2.0, dtype=torch.float32))


class _Features(tuple):
    def __new__(cls, x_norm, y_norm):
        # head = 단위 행렬 3×3이 되도록 특징 3개를 둔다.
        h = torch.zeros(len(x_norm), 4)
        h[:, :3] = x_norm
        m = torch.ones(len(x_norm), 3)
        return super().__new__(cls, (h, y_norm, m))


def _fake_model(per_run, grade_runs=None):
    predictor = FakePredictor(per_run, grade_runs)
    eye = torch.zeros(3, 4)
    eye[:3, :3] = torch.eye(3)
    predictor.base = {"main": (eye, torch.zeros(3)), "nograde": (eye.clone(), torch.zeros(3))}
    return SimpleNamespace(predictor=predictor, _mutation_free=True, lock=None)


def _frames(ids):
    import pandas as pd
    return [pd.DataFrame({"session_id": [sid]}) for sid in ids]


def test_ai06_compute_gb_matches_closed_form_with_shrink_and_counts_runs():
    rng = np.random.default_rng(1)
    per_run = {}
    xs, ys = [], []
    for sid in range(1, 21):
        x = rng.normal(scale=5.0, size=(30, 3))
        y = 0.9 * x + 0.5 + rng.normal(scale=0.2, size=(30, 3))
        per_run[sid] = (x, y)
        xs.append(x), ys.append(y)
    model = _fake_model(per_run)
    out = gru_gb.compute_gb(model, _frames(range(1, 21)), limit=10_000)
    g_raw, b_raw = np.polyfit(np.concatenate(xs).ravel(), np.concatenate(ys).ravel(), 1)
    s = 20 / 70
    assert out[gru_gb.SUPPORT_KEY] == 20
    assert out[gru_gb.GAIN_KEY] == pytest.approx(1 + s * (g_raw - 1), abs=1e-5)
    assert out[gru_gb.OFFSET_KEY] == pytest.approx(s * b_raw, abs=1e-3)


def test_ai06_window_cap_stops_at_newer_runs_and_nograde_fallback():
    per_run = {sid: (np.full((30, 3), float(sid)) + np.arange(30)[:, None], np.zeros((30, 3))) for sid in range(1, 6)}
    model = _fake_model(per_run)
    x, _y, n = gru_gb.support_pairs(model, _frames([5, 4, 3, 2, 1]), limit=70)
    assert n == 3 and len(x) == 70 * 3                                   # 30 + 30 + 10창
    model = _fake_model(per_run, grade_runs=set())                        # 경사 없는 런뿐
    _x, _y, n = gru_gb.support_pairs(model, _frames([1, 2]), limit=100)
    assert n == 2 and {key for _sid, key in model.predictor.calls} == {"main", "nograde"}


def test_ai06_no_support_runs_gives_identity():
    model = _fake_model({})
    assert gru_gb.compute_gb(model, [], limit=10) == {gru_gb.GAIN_KEY: 1.0, gru_gb.OFFSET_KEY: 0.0,
                                                      gru_gb.SUPPORT_KEY: 0}


def _personalize(real_gru, monkeypatch, flag):
    from app.ode_schemas import PersonalizeRequest
    import app.main as main_module

    if flag:
        monkeypatch.setenv("GRU_GB_PERSONALIZATION_ENABLED", "true")
    else:
        monkeypatch.delenv("GRU_GB_PERSONALIZATION_ENABLED", raising=False)
    body = PersonalizeRequest.model_validate(personalize_body(support_session(51), support_session(52, hr_shift=4)))
    monkeypatch.setattr(main_module, "compute_personalization", lambda *_a, **_k: {
        "schemaVersion": "runway.ode.personalization.v1", "warnings": [], "userId": 73,
        "summaryU": {"hr_ref": 150.0}})
    with app_client(real_gru, ode=SimpleNamespace()) as client:
        response = client.post("/v1/hr/personalize", json=body.model_dump(by_alias=True, mode="json"))
    assert response.status_code == 200
    return response.json()


def test_ai06_flag_off_leaves_summary_untouched_and_on_adds_three_keys(real_gru, monkeypatch):
    off = _personalize(real_gru, monkeypatch, False)
    assert off["summaryU"] == {"hr_ref": 150.0}
    on = _personalize(real_gru, monkeypatch, True)
    summary = on["summaryU"]
    assert summary["hr_ref"] == 150.0
    assert summary[gru_gb.SUPPORT_KEY] == 2
    assert 0.5 <= summary[gru_gb.GAIN_KEY] <= 2.0 and abs(summary[gru_gb.OFFSET_KEY]) <= 8.0
    # 저장된 값을 읽는 쪽 검증을 그대로 통과한다.
    assert gru_gb.parse_gb(str(summary[gru_gb.GAIN_KEY]), str(summary[gru_gb.OFFSET_KEY])) == (
        summary[gru_gb.GAIN_KEY], summary[gru_gb.OFFSET_KEY])
    assert {k: v for k, v in on.items() if k != "summaryU"} == {k: v for k, v in off.items() if k != "summaryU"}


# ---------------------------------------------------------------- 표시(응답 pacing·그룹 기록)
class GbRowN(GbRow):
    def __init__(self, gain, offset, n):
        self.result = HrThresholdLookupResult(190.0, 170.0, 2, gru_gain=gain, gru_offset_bpm=offset, gru_support_n=n)


def test_weight_rises_with_runs_k50():
    assert gru_gb.SHRINK_K == 50
    assert [round(gru_gb.personal_weight(n, 0.9, 0.1), 4) for n in (5, 20, 50)] == [0.0909, 0.2857, 0.5]
    assert gru_gb.personal_weight(20, 1.0, 0.0) == 0.0 and gru_gb.personal_weight(0, 0.9, 0.1) == 0.0
    assert gru_gb.parse_support_n("20") == 20
    assert gru_gb.parse_support_n("2.5") == gru_gb.parse_support_n(None) == gru_gb.parse_support_n(-1) == 0


def test_support_n_is_read_from_same_row():
    row = {"hr_danger_bpm": Decimal("195"), "hr_sustain_bpm": Decimal("180"), "hr_threshold_run_count": 2,
           "gru_gain": "0.95", "gru_offset_bpm": "0.3", "gru_support_n": "37"}
    assert CachedDbHrThresholdLookup(FakeDb(row)).get_for_user(7).gru_support_n == 37
    assert "summary_u_json->>'gruSupportN'" in HR_THRESHOLD_SQL


def test_ai04_pacing_indicator_only_when_on(monkeypatch):
    off_json, _ = _ai04(monkeypatch, None, GbRowN(0.9, 0.5, 20))
    assert "gruPersonalWeight" not in off_json["pacing"] and "gruSupportN" not in off_json["pacing"]
    on_json, _ = _ai04(monkeypatch, "true", GbRowN(0.9, 0.5, 20))
    assert on_json["pacing"]["gruSupportN"] == 20
    assert on_json["pacing"]["gruPersonalWeight"] == pytest.approx(20 / 70)
    none_json, _ = _ai04(monkeypatch, "true", GbRowN(1.0, 0.0, 0))     # 키 없음: 적용 안 됨
    assert none_json["pacing"]["gruPersonalWeight"] == 0.0 and none_json["pacing"]["gruSupportN"] == 0


def test_ai10_detail_carries_member_indicator_only_when_on():
    from app.group_pace.schemas import GroupPaceRequest
    from app.group_pace.service import recommend_group_pace
    from demo_fakes import T0

    class Rows:
        def get_for_user(self, user_id):
            return {1: HrThresholdLookupResult(190.0, 170.0, 2, gru_gain=0.9, gru_offset_bpm=1.0, gru_support_n=50),
                    2: HrThresholdLookupResult(190.0, 170.0, 2)}[int(user_id)]

    body = {"groupRunId": 3, "currentGroupPaceSecPerKm": 340, "goalPaceSecPerKm": 320,
            "startRecommendedPaceSecPerKm": None, "elapsedSec": 300, "now": T0.isoformat(), "lastChange": None,
            "participants": [_member(1, 150.0), _member(2, 160.0)]}
    for enabled in (False, True):
        detail = {}
        recommend_group_pace(GroupPaceRequest.model_validate(body), GroupModel(),
                             MpcPolicy(load_policy_config(), flat_table(0.0)), hr_threshold_lookup=Rows(),
                             detail=detail, gru_gb_enabled=enabled)
        if not enabled:
            assert all("gruGb" not in m for m in detail["members"])
        else:
            assert detail["members"][0]["gruGb"] == {"applied": True, "supportN": 50, "weight": 0.5}
            assert detail["members"][1]["gruGb"] == {"applied": False, "supportN": 0, "weight": 0.0}
