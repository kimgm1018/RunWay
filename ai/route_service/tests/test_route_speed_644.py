"""S15P31E105-644: 창 env 레이어를 처음 쓸 때 읽는 env dict(LazyLayersEnv)가 예전 dict와 같은 key·순서·값을 주는지."""
import copy
import json
import pickle

import pytest

from runway_routing.national import region as R


def _make(calls):
    def load():
        calls.append(1)
        return {"table": "layers"}          # gpkg 표 대신 쓰는 아무 객체
    eager = {"name": "wide", "layers": {"table": "layers"}, "extent_wsen": (1, 2, 3, 4), "path": "p", "note": "n"}
    lazy = R.LazyLayersEnv(load, {**eager, "layers": R._PENDING})
    return eager, lazy


def test_not_read_until_layers_used():
    calls = []
    _, env = _make(calls)
    # LOOP·OAB 경로가 쓰는 것: 다른 key 읽기, layers가 있는지, isinstance
    assert env["name"] == "wide" and env["note"] == "n" and env.get("path") == "p" and env.get("x", 7) == 7
    assert "layers" in env and isinstance(env, dict) and len(env) == 5
    assert calls == []
    assert env["layers"] == {"table": "layers"} and env.get("layers") is env["layers"]
    assert calls == [1]                     # 한 번만 읽는다


@pytest.mark.parametrize("view", [
    lambda e: dict(e), lambda e: {**e}, lambda e: list(e.items()), lambda e: list(e.values()), lambda e: list(e),
    lambda e: e.copy(), lambda e: copy.copy(e), lambda e: copy.deepcopy(e), lambda e: pickle.loads(pickle.dumps(e)),
    lambda e: json.loads(json.dumps({k: v for k, v in e.items()}, default=str)), lambda e: repr(e)])
def test_every_view_sees_the_loaded_value(view):
    calls = []
    eager, env = _make(calls)
    got, want = view(env), view(eager)
    assert got == want and calls == [1]
    assert R._PENDING not in dict.values(env)
    assert list(dict.keys(env)) == list(eager)            # key 순서도 예전 dict와 같다
    assert env == eager


def test_flag_off_reads_when_window_is_built(monkeypatch):
    # RUNWAY_LAZY_ENV_LAYERS=0 이면 make_pipeline이 예전처럼 바로 읽은 표를 담은 보통 dict를 쓴다
    assert R.LAZY_ENV_LAYERS in (True, False)
    monkeypatch.setenv("RUNWAY_LAZY_ENV_LAYERS", "x")
    from runway_routing.env_flags import flag
    with pytest.raises(ValueError):
        flag("RUNWAY_LAZY_ENV_LAYERS")
