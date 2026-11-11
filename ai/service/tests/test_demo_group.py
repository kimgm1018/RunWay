"""AI10 그룹 판단이 시연 스트림에 기록되는지 확인한다(S15P31E105-628)."""
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.demo.buffer import GROUP_KEY_OFFSET, DemoBuffer, group_key
from app.demo.group_trace import reason_code
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T, demo_settings, fixed_clock, flat_table
from test_group_pace_ai10 import GroupModel, body, participant, run


@pytest.fixture(autouse=True)
def group_enabled(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "true")


def client(tmp_path, settings=None, model=None):
    settings = settings if settings is not None else demo_settings(tmp_path)
    app = create_app(lambda: model or GroupModel(), lambda: MpcPolicy(load_policy_config(), flat_table(0)),
                     clock=fixed_clock(3.0), demo_loader=lambda: settings)
    return TestClient(app)


def speed_model(pace, hr):
    # 빠를수록 심박이 오르는 가짜 GRU: 340초/km에서 hr+5, 10초 빨라질 때마다 +2
    rise = 5 + (340 - pace) * 0.2
    return [hr + rise * 0.4, hr + rise * 0.7, hr + rise]


def test_group_key_does_not_collide_with_sessions():
    assert group_key(3) == GROUP_KEY_OFFSET + 3
    buffer = DemoBuffer("b", allowlist=frozenset({201}), now=lambda: T, group_allowlist=frozenset({3}))
    assert buffer.allowed(201) and not buffer.allowed(202)
    assert buffer.allowed(group_key(3)) and not buffer.allowed(group_key(4))
    open_groups = DemoBuffer("b", allowlist=frozenset({201}), now=lambda: T)
    assert open_groups.allowed(group_key(99))          # 그룹 허용 목록이 없으면 모든 그룹


def test_reason_codes():
    assert reason_code("FAST", "RECOVERED") == "SPEED_UP"
    assert reason_code("SLOW", "HR_LIMIT") == "SLOW_DOWN"
    assert reason_code("SLOW", "FLOOR") == "SLOW_DOWN"
    assert reason_code("SLOW", "WARMUP_CAP") == "WARMUP"
    assert reason_code("HOLD", "COOLDOWN") == "COOLDOWN"
    assert reason_code("HOLD", "SMALL_CHANGE") == "HOLD"


def test_detail_does_not_change_response():
    data = body(participants=[participant(1, hr=150), participant(2, hr=165)])
    plain = run(data, GroupModel(speed_model))
    from app.group_pace.schemas import GroupPaceRequest
    from app.group_pace.service import recommend_group_pace
    detail = {}
    with_detail = recommend_group_pace(GroupPaceRequest.model_validate(data), GroupModel(speed_model),
                                       MpcPolicy(load_policy_config(), flat_table(0)),
                                       hr_threshold_lookup_configured=False, detail=detail)
    assert with_detail == plain
    assert len(detail["members"]) == 2 and len(detail["paces"]) == len(detail["members"][0]["upper"])


def test_group_pace_records_trace_on_group_stream(tmp_path):
    data = body(participants=[participant(1, hr=150), participant(2, hr=166)])
    with client(tmp_path, model=GroupModel(speed_model)) as c:
        r = c.post("/v1/group/pace", json=data)
        assert r.status_code == 200
        traces = c.app.state.demo.buffer.traces(group_key(3))
    assert "traceId" not in r.json()                     # AI10 응답 계약은 그대로
    t = traces[-1]
    assert t["kind"] == "GROUP" and t["groupRunId"] == 3 and t["stage"] == "L1A"
    assert t["policyVersion"] == load_policy_config().policy_version
    g = t["group"]
    assert [m["label"] for m in g["members"]] == ["러너 1", "러너 2"]
    n = len(g["candidates"])
    for m in g["members"]:
        assert len(m["predHr120Bpm"]) == n and len(m["upperHrBpm"]) == n and len(m["passed"]) == n
        assert m["hrNowBpm"] is not None and m["allowBpm"] is not None
    assert g["worstIndex"] == 1                            # 심박이 높은 러너 2가 가장 빠듯하다
    d = t["decision"]
    assert d["fromPaceSecPerKm"] == 340 and d["reasonCode"] in {"SPEED_UP", "SLOW_DOWN", "HOLD", "COOLDOWN", "WARMUP"}
    assert d["recommendedPaceSecPerKm"] == r.json()["groupPaceSecPerKm"]
    assert g["candidates"][g["chosenIndex"]]["paceSecPerKm"] == d["recommendedPaceSecPerKm"]
    json.dumps(t, ensure_ascii=False)                     # SSE로 보낼 수 있다


def test_group_story_speed_up_hold_slow_down(tmp_path):
    with client(tmp_path, model=GroupModel(speed_model)) as c:
        up = c.post("/v1/group/pace", json=body(currentGroupPaceSecPerKm=370, goalPaceSecPerKm=350,
                                                participants=[participant(1, hr=140, pace=370)])).json()
        hold = c.post("/v1/group/pace", json=body(currentGroupPaceSecPerKm=350, goalPaceSecPerKm=350,
                                                  participants=[participant(1, hr=145, pace=350)])).json()
        down = c.post("/v1/group/pace", json=body(currentGroupPaceSecPerKm=350, goalPaceSecPerKm=350,
                                                  participants=[participant(1, hr=145, pace=350),
                                                                participant(2, hr=172, pace=350)])).json()
        codes = [t["decision"]["reasonCode"] for t in c.app.state.demo.buffer.traces(group_key(3))]
    assert (up["direction"], hold["direction"], down["direction"]) == ("FAST", "HOLD", "SLOW")
    assert codes == ["SPEED_UP", "HOLD", "SLOW_DOWN"]


def test_group_not_in_allowlist_is_not_recorded(tmp_path):
    settings = demo_settings(tmp_path)
    settings = replace(settings, config=replace(settings.config, group_allowlist=frozenset({77})))
    with client(tmp_path, settings=settings) as c:
        assert c.post("/v1/group/pace", json=body()).status_code == 200
        assert c.app.state.demo.buffer.traces(group_key(3)) == []
        assert c.app.state.demo.buffer.latest_session() is None


def test_demo_off_has_no_detail(monkeypatch, tmp_path):
    for k in ("DEMO_STREAM_ENABLED", "DEMO_VIEW_TOKEN", "DEMO_INGEST_TOKEN", "DEMO_CONFIG_PATH"):
        monkeypatch.delenv(k, raising=False)
    calls = []
    import app.main as main_module
    original = main_module.recommend_group_pace

    def spy(*args, **kwargs):
        calls.append(kwargs.get("detail"))
        return original(*args, **kwargs)

    monkeypatch.setattr(main_module, "recommend_group_pace", spy)
    app = create_app(lambda: GroupModel(), lambda: MpcPolicy(load_policy_config(), flat_table(0)), clock=fixed_clock(3.0))
    with TestClient(app) as c:
        assert c.app.state.demo is None
        assert c.post("/v1/group/pace", json=body()).status_code == 200
    assert calls == [None]


def test_group_stream_snapshot_uses_group_label(tmp_path):
    from demo_fakes import VIEW
    settings = demo_settings(tmp_path)
    settings = replace(settings, config=replace(settings.config, group_label="발표 그룹런"))
    with client(tmp_path, settings=settings) as c:
        c.post("/v1/group/pace", json=body())
        c.app.state.demo_stream_max_loops = 0
        r = c.get(f"/v1/demo/sessions/{group_key(3)}/events", headers=VIEW)
    assert r.status_code == 200
    first = r.text.split("\n\n")[0]
    payload = json.loads(first.split("data: ", 1)[1])
    assert payload["label"] == "발표 그룹런" and payload["traces"][0]["kind"] == "GROUP"


def test_config_reads_group_fields(tmp_path):
    from app.demo.config import load_demo_config
    demo_settings(tmp_path)
    path = tmp_path / "demo.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw.update({"groupAllowlist": [3, 5], "groupLabel": "그룹"})
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    cfg = load_demo_config(path)
    assert cfg.group_allowlist == frozenset({3, 5}) and cfg.group_label == "그룹"


def test_offline_group_replay_tells_the_demo_story(tmp_path):
    from tools.offline_group_replay import build_group_recording
    rec = build_group_recording(recording_id="group_test", label="합성", out_dir=tmp_path)   # 저장소의 실제 여유 표
    codes = [t["decision"]["reasonCode"] for t in rec["traces"]]
    first = {c: codes.index(c) for c in ("SPEED_UP", "HOLD", "SLOW_DOWN")}
    assert first["SPEED_UP"] < first["HOLD"] < first["SLOW_DOWN"]              # 가속 → 유지 → 감속
    assert rec["traces"][0]["decision"]["fromPaceSecPerKm"] == 370
    assert (tmp_path / "group_test.js").read_text(encoding="utf-8").startswith("window.RunwayDemoRecordings.push(")
    assert "group_test.js" in (tmp_path / "index.js").read_text(encoding="utf-8")


def test_offline_group_replay_runner_count_follows_demo_size(tmp_path):
    from tools.offline_group_replay import build_group_recording
    rec = build_group_recording(recording_id="group_two", label="합성", out_dir=tmp_path, runners=2)
    assert all(len(t["group"]["members"]) == 2 for t in rec["traces"])       # 시연 2명이면 판정판도 2행
    codes = [t["decision"]["reasonCode"] for t in rec["traces"]]
    assert "SPEED_UP" in codes and "SLOW_DOWN" in codes                       # 마지막 러너가 감속 이야기를 맡는다
    with pytest.raises(ValueError):
        build_group_recording(recording_id="group_zero", label="합성", out_dir=tmp_path, runners=0)
