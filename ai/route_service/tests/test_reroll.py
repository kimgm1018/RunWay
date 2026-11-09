"""재추천 제외(S15P31E105-383) 단위 테스트: seed -> 되돌아볼 묶음 수, 코스 결과 cache(TTL·LRU), 순위표 skip,
서비스의 이전 응답 찾기(cache hit / miss 재계산)와 첫 요청이 예전 호출 그대로인지. 데이터 불필요.
실제 엔진으로 하는 확인은 test_engine_api.py(test_reroll_*)와 reports/route_reroll_383_2026-11-05가 본다."""
import copy
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import reroll
from app.config import Settings
from app.main import ATTEMPTS, _lookback, _run_excluding, _served, create_app
from app.schemas import RecommendRequest
from runway_routing import scorer

URL = "/internal/v1/routes/recommendations"
BODY = {"lat": 35.1532, "lon": 129.1186, "distance_km": 5.0}


@pytest.mark.parametrize("seed, want", [(1, 0), (24, 0), (25, 1), (48, 1), (49, 2), (72, 2), (73, 2), (10_000_000, 2)])
def test_depth(seed, want):
    assert reroll.depth(seed, ATTEMPTS) == want


def test_condition_key_ignores_end_point_unless_p2p_and_off_filters():
    a = RecommendRequest(**BODY, end_lat=35.0, end_lon=129.0)
    b = RecommendRequest(**BODY, filters={"park": False})
    assert reroll.condition_key(a, 5000) == reroll.condition_key(b, 5000)
    c = RecommendRequest(**BODY, filters={"park": True})
    assert reroll.condition_key(c, 5000) != reroll.condition_key(b, 5000)
    p1 = RecommendRequest(**BODY, shape="point_to_point", end_lat=35.1, end_lon=129.1)
    p2 = RecommendRequest(**BODY, shape="point_to_point", end_lat=35.1, end_lon=129.2)
    assert reroll.condition_key(p1, 5000) != reroll.condition_key(p2, 5000)


def test_cache_ttl_and_lru():
    now = [0.0]
    c = reroll.ShownCache(size=2, ttl_s=600, clock=lambda: now[0])
    v = reroll.pack([{"eids": [1, 2, 3]}])
    c.put("a", v)
    c.put("b", v)
    assert c.get("a") is v          # a를 최근으로
    c.put("c", v)                   # 가장 오래 안 쓴 b가 밀려남
    assert c.get("b") is None and c.get("a") is v and c.get("c") is v
    now[0] = 601.0
    assert c.get("a") is None and len(c) == 1   # TTL 지나면 miss, 지운다
    assert c.hits == 3 and c.misses == 2
    assert v[0].dtype == np.int32 and c.nbytes() > 0


def test_pack_copies_instead_of_viewing():
    big = np.arange(1000, dtype=np.int32)
    v = reroll.pack([{"eids": big[:3]}])
    assert v[0].base is None and v[0].tolist() == [0, 1, 2]


def _r(cid, score, eids):
    return {"candidate_id": cid, "s": {"score": score}, "eids": eids}


def test_rank_skip_removes_and_does_not_block():
    length = np.ones(10)
    valid = [_r(1, 3.0, [0, 1, 2]), _r(2, 2.0, [0, 1, 2, 3]), _r(3, 1.0, [7, 8])]
    assert [r["candidate_id"] for r in scorer.rank(valid, "s", length)] == [1, 3]   # 2는 1의 중복
    assert [r["candidate_id"] for r in scorer.rank(valid, "s", length, frozenset({1}))] == [2, 3]
    assert scorer.rank(valid, "s", length) == scorer.rank(valid, "s", length, frozenset())


# ------------------------------------------------------------------ 서비스: 이전 응답 찾기
def _out(eids_list, excluded=None):
    o = {"issues": [], "canonical": {"start": {"snap_node_dist_m": 1.0}}, "preference": None,
         "baseline": [{"eids": e} for e in eids_list]}
    if excluded is not None:
        o["reroll"] = {"shown_routes": 1, "excluded": excluded}
    return o


class SeedPipe:
    """seed마다 다른 TOP3를 돌려주는 가짜 pipeline. 호출을 기록한다."""

    def __init__(self):
        self.calls = []

    def run(self, lat, lon, target_m, seed=1, attempts=None, prefs=None, shown=None, **kw):
        self.calls.append((seed, None if shown is None else [list(map(int, s)) for s in shown]))
        out = _out([[seed, seed + 1], [seed + 2], [seed + 3]])
        if shown:
            out["reroll"] = {"shown_routes": len(shown), "excluded": []}
        return out


def test_lookback_hit_uses_cache_and_miss_recomputes_same_value():
    req = RecommendRequest(**BODY, seed=49)
    cond = reroll.condition_key(req, 5000)
    cold, p = reroll.ShownCache(), SeedPipe()
    shown_miss, st = _lookback(p, cold, cond, req, 5000, None, {}, 2)
    # miss: seed 1(depth 0)을 한 번만 계산하고(memo), seed 25(depth 1)를 seed 1 제외로 계산
    assert [c[0] for c in p.calls] == [1, 25] and p.calls[0][1] is None and p.calls[1][1] == [[1, 2], [3], [4]]
    assert st == {"hits": 0, "misses": 2, "recomputed_runs": 2} and len(cold) == 0   # 재계산 값은 넣지 않는다
    warm, p2 = reroll.ShownCache(), SeedPipe()
    warm.put((cond, 1, 0), reroll.pack(_served(p.run(0, 0, 0, seed=1), True)))
    warm.put((cond, 25, 1), reroll.pack(_served(p.run(0, 0, 0, seed=25, shown=[[1]]), True)))
    shown_hit, st = _lookback(p2, warm, cond, req, 5000, None, {}, 2)
    assert p2.calls == [] and st["hits"] == 2
    assert [a.tolist() for a in shown_hit] == [a.tolist() for a in shown_miss]
    assert [a.tolist() for a in shown_hit] == [[25, 26], [27], [28], [1, 2], [3], [4]]   # s-24 다음 s-48


@pytest.mark.parametrize("active", ["baseline", "preference"])
def test_run_excluding_keeps_empty_result_when_everything_was_excluded(active):
    class Pipe:
        def __init__(self):
            self.calls = []
            self.out = _out([], excluded=[1, 2])
            if active == "preference":
                self.out.update(baseline=[{"eids": [9]}], preference=[])

        def run(self, *a, shown=None, **kw):
            self.calls.append(shown)
            return self.out if shown else _out([[9]])

    req = RecommendRequest(**BODY, seed=25)
    p = Pipe()
    out = _run_excluding(p, req, 25, 5000, None, {}, [np.array([1])])
    assert len(p.calls) == 1 and p.calls[0][0].tolist() == [1]
    assert out is p.out and out[active] == []
    assert out["reroll"] == {"shown_routes": 1, "excluded": [1, 2], "all_excluded": True}


@pytest.mark.parametrize("remaining", [1, 2])
@pytest.mark.parametrize("active", ["baseline", "preference"])
def test_run_excluding_returns_remaining_courses_unchanged(remaining, active):
    expected = _out([[9], [10]][:remaining], excluded=[1, 2])
    if active == "preference":
        expected["preference"], expected["baseline"] = expected["baseline"], [{"eids": [1]}]
    before = copy.deepcopy(expected)

    class Pipe:
        def run(self, *a, **kw):
            return expected

    req = RecommendRequest(**BODY, seed=25)
    out = _run_excluding(Pipe(), req, 25, 5000, None, {}, [np.array([1])])
    assert out is expected and out == before
    assert _served(out, True) == [{"eids": [9]}, {"eids": [10]}][:remaining]


def test_served_is_empty_for_blocking_errors():
    o = _out([[1]])
    assert len(_served(o, True)) == 1
    o["issues"].append({"code": "FORBIDDEN_EDGE_USED"})
    assert _served(o, True) == []
    o = _out([[1]])
    o["canonical"]["start"]["snap_node_dist_m"] = 300.0
    assert _served(o, True) == []


# ------------------------------------------------------------------ 서비스: 첫 요청은 예전 호출 그대로
class FakePipeline:
    def __init__(self):
        self.lock = threading.Lock()
        self.shape_cfg = {"tolerance": {"value": 0.10}, "app_km": {"max": 21.1}, "snap_max_m": {"value": 250}}
        self.calls = []

    def run(self, *args, **kw):
        self.calls.append(kw)
        return copy.deepcopy({"request": {"generation_bias": None}, "issues": [],
                              "canonical": {"start": {"snap_node_dist_m": 1.0, "node_lat": 35.0, "node_lon": 129.0}},
                              "graph": None, "counts": {"attempts": 24, "generated": 0, "distinct": 0, "loop_valid": 0},
                              "pool": [], "baseline": [], "preference": None})

    def graph(self, *a):
        return None


def _client(tmp_path, exclude=True, warmup=False, pipe=None):
    pipe = pipe if pipe is not None else FakePipeline()
    s = Settings(debug=False, warmup=warmup, gate_mode="enforce", fast_graph=True,
                 usability_log_dir=tmp_path / "gate", reroll_exclude=exclude)
    return TestClient(create_app(s, lambda _: pipe, background=False)), pipe


class AllExcludedPipeline(FakePipeline):
    """첫 묶음의 코스가 재추천에서도 반복되어 모두 제외되는 가짜 pipeline."""

    def run(self, *args, **kw):
        out = super().run(*args, **kw)
        if kw.get("shown"):
            out["reroll"] = {"shown_routes": len(kw["shown"]), "excluded": [1]}
        else:
            out["baseline"] = [{"eids": [1, 2]}]
        return out


def test_all_excluded_api_returns_no_route_and_hit_matches_miss(tmp_path):
    c, pipe = _client(tmp_path, pipe=AllExcludedPipeline())
    cond = reroll.condition_key(RecommendRequest(**BODY), 5000)
    with c:
        engine = c.app.state.engine
        engine.reroll.put((cond, 1, 0), reroll.pack([{"eids": [1, 2]}]))
        hit25 = c.post(URL, json={**BODY, "seed": 25})
        assert engine.reroll.get((cond, 25, 1)) == ()
        hit49 = c.post(URL, json={**BODY, "seed": 49})
        assert [k["seed"] for k in pipe.calls] == [25, 49]
        assert [a.tolist() for a in pipe.calls[-1]["shown"]] == [[1, 2]]
        assert engine.reroll.get((cond, 49, 2)) == ()

        engine.reroll = reroll.ShownCache()
        pipe.calls.clear()
        miss25 = c.post(URL, json={**BODY, "seed": 25})
        assert engine.reroll.get((cond, 25, 1)) == ()
        engine.reroll = reroll.ShownCache()
        miss49 = c.post(URL, json={**BODY, "seed": 49})
        assert [k["seed"] for k in pipe.calls] == [1, 25, 1, 25, 49]
        assert [a.tolist() for a in pipe.calls[-1]["shown"]] == [[1, 2]]
        assert engine.reroll.get((cond, 49, 2)) == ()

    for response in (hit25, hit49, miss25, miss49):
        assert response.status_code == 422
        assert response.json() == {"code": "NO_ROUTE", "message": "이 조건으로 더 보여 드릴 다른 코스가 없어요.",
                                   "details": None}
        assert response.content == hit25.content


@pytest.mark.parametrize("gate_failed", [False, True])
def test_empty_reroll_preserves_normal_no_route_and_gate_errors(tmp_path, gate_failed):
    from app.errors import MESSAGES

    class Pipe(FakePipeline):
        def run(self, *args, **kw):
            out = super().run(*args, **kw)
            out["reroll"] = {"shown_routes": len(kw.get("shown", [])), "excluded": [1] if gate_failed else []}
            if gate_failed:
                out["issues"] = [{"code": "USABILITY_GATE_ALL_FAILED"}]
            return out

    c, _ = _client(tmp_path, pipe=Pipe())
    cond = reroll.condition_key(RecommendRequest(**BODY), 5000)
    with c:
        c.app.state.engine.reroll.put((cond, 1, 0), reroll.pack([{"eids": [1, 2]}]))
        response = c.post(URL, json={**BODY, "seed": 25})
    code = "USABILITY_GATE_ALL_FAILED" if gate_failed else "NO_ROUTE"
    assert response.status_code == 422
    assert response.json() == {"code": code, "message": MESSAGES[code], "details": None}


def test_first_request_calls_engine_exactly_as_before(tmp_path):
    c, pipe = _client(tmp_path)
    with c:
        c.post(URL, json={**BODY, "seed": 24})
        assert len(pipe.calls) == 1 and "shown" not in pipe.calls[0]
        assert c.app.state.engine.reroll.puts == 1   # 응답한 요청은 cache에 넣는다(코스 0개도)


def test_reroll_after_first_request_hits_cache(tmp_path):
    c, pipe = _client(tmp_path)
    with c:
        c.post(URL, json={**BODY, "seed": 1})
        c.post(URL, json={**BODY, "seed": 25})
        # seed 1 응답이 코스 0개(오류)였으므로 뺄 것이 없어 첫 요청과 같은 호출
        assert [k.get("seed") for k in pipe.calls] == [1, 25] and "shown" not in pipe.calls[1]
        assert c.app.state.engine.reroll.hits == 1


def test_reroll_without_cache_recomputes_prior_batches(tmp_path):
    c, pipe = _client(tmp_path)
    with c:
        c.post(URL, json={**BODY, "seed": 49})
        assert [k.get("seed") for k in pipe.calls] == [1, 25, 49]


def test_warmup_is_not_remembered(tmp_path):
    c, pipe = _client(tmp_path, warmup=True)
    with c:
        assert len(pipe.calls) == 1 and c.app.state.engine.reroll.puts == 0


def test_switch_off_is_old_behaviour(tmp_path):
    c, pipe = _client(tmp_path, exclude=False)
    with c:
        c.post(URL, json={**BODY, "seed": 49})
        assert len(pipe.calls) == 1 and "shown" not in pipe.calls[0] and c.app.state.engine.reroll is None
