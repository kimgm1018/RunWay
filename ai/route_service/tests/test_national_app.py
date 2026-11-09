"""실제 전국 자료 없이 서비스 모드, 잠금, 재시도, LRU와 재추천 경로 검사."""
import copy
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app, _default_pipeline_factory
from app.national import NationalPipeline
from runway_routing.national.fit import window_spec
from runway_routing.national.store import OutOfArea
from test_api import BODY, P2P, URL, READY, FakePipeline, settings, loop_out, issue, SHAPE_CFG


@pytest.fixture(autouse=True)
def no_host_memory_pressure(monkeypatch):
    # 메모리 해제 시험만 사용량을 지정한다. 나머지는 실행 환경의 RSS에 좌우되지 않는다.
    monkeypatch.setattr('app.national._anon_mib', lambda: None)


class FakeStore:
    def contains(self, lat, lon):
        return lat is not None and lon is not None and 32 <= lat <= 39 and 124 <= lon <= 132

    def spec(self, lat, lon, target_m, shape='loop', end_lat=None, end_lon=None):
        return window_spec((702500+lon, 1302500+lat), shape, target_m,
                           (0, 0) if shape == 'point_to_point' else None)


def adapter(tmp_path, outputs, size=1):
    cfg = replace(settings(tmp_path, warmup=False), data_mode='national', national_dir=tmp_path, window_cache_size=size)
    built = []

    def builder(store, prep, spec, **kw):
        p = FakePipeline(outputs(spec))
        p.gate = SimpleNamespace(files={})
        p.gen = SimpleNamespace(_cache={})
        p.graphs = SimpleNamespace(_graphs={})
        p.substrate = SimpleNamespace(_masks={})
        built.append((spec, p))
        return p

    return NationalPipeline(cfg, store=FakeStore(), prep=object(), builder=builder), cfg, built


@pytest.mark.parametrize('value', ['-1', 'abc', 'nan', 'inf', '-inf', ''])
def test_invalid_release_anon_settings(monkeypatch, value):
    monkeypatch.setenv('ROUTE_RELEASE_ANON_MIB', value)
    with pytest.raises(ValueError, match='ROUTE_RELEASE_ANON_MIB'):
        load_settings()


def test_release_anon_default_and_override(monkeypatch):
    monkeypatch.delenv('ROUTE_RELEASE_ANON_MIB', raising=False)
    assert load_settings().release_anon_mib == 1024.0
    monkeypatch.setenv('ROUTE_RELEASE_ANON_MIB', '12.5')
    assert load_settings().release_anon_mib == 12.5
    monkeypatch.setenv('ROUTE_RELEASE_ANON_MIB', '0')
    assert load_settings().release_anon_mib == 0.0


@pytest.mark.parametrize('value', [-1, float('nan'), float('inf'), 'abc', None, True])
def test_direct_release_anon_settings_validation(tmp_path, value):
    with pytest.raises(ValueError, match='ROUTE_RELEASE_ANON_MIB'):
        replace(settings(tmp_path), release_anon_mib=value)


@pytest.mark.parametrize('same,anon,threshold,substrate,cleared', [
    (True, 1700, 1024, True, False),
    (False, 1700, 1024, True, True),
    (False, 1023, 1024, True, False),
    (False, 1024, 1024, True, False),
    (False, None, 1024, True, False),
    (False, 1700, 1024, False, True),
    (False, 0, 0, True, True),
    (True, 1700, 0, True, False),
    (False, None, 0, True, False),
])
def test_release_request_caches(tmp_path, monkeypatch, same, anon, threshold, substrate, cleared):
    import app.national as N
    pipe, cfg, _ = adapter(tmp_path, lambda s: loop_out())
    pipe.settings = replace(cfg, release_anon_mib=threshold)
    p = pipe.active
    p.gen._cache['graph'] = object()
    p.graphs._graphs['request'] = object()
    if substrate:
        p.substrate._masks['p2p'] = object()
    else:
        p.substrate = None
    signature = (37.5, 127.0, 21100, 'loop', None, None)
    pipe._last_signature = signature if same else (37.5, 127.0, 5000, 'loop', None, None)
    monkeypatch.setattr(N, '_anon_mib', lambda: anon)
    monkeypatch.setattr(N, '_malloc_trim', lambda: None)

    pipe._release_if_new(signature)

    assert bool(p.gen._cache) is (not cleared)
    assert bool(p.graphs._graphs) is (not cleared)
    if substrate:
        assert bool(p.substrate._masks) is (not cleared)


def test_seed_only_reroll_keeps_graph_caches(tmp_path, monkeypatch):
    import app.national as N
    monkeypatch.setattr(N, '_anon_mib', lambda: 1700)
    monkeypatch.setattr(N, '_malloc_trim', lambda: None)
    pipe, _, _ = adapter(tmp_path, lambda s: loop_out())
    pipe.run(37.5, 127.0, 21100, seed=1)
    p = pipe.active
    p.gen._cache['graph'] = object()
    p.graphs._graphs['request'] = object()
    p.substrate._masks['p2p'] = object()

    pipe.run(37.5, 127.0, 21100, seed=25)

    assert pipe.active is p
    assert p.gen._cache and p.graphs._graphs and p.substrate._masks
    assert [call[1]['seed'] for call in p.calls] == [1, 25]


@pytest.mark.parametrize('name,value', [('ROUTE_DATA_MODE', 'off'), ('ROUTE_DATA_MODE', ''),
    ('ROUTE_WINDOW_CACHE_SIZE', '0'), ('ROUTE_WINDOW_CACHE_SIZE', '-1'), ('ROUTE_WINDOW_CACHE_SIZE', '1.5'),
    ('ROUTE_WINDOW_CACHE_SIZE', 'no'), ('ROUTE_DATA_MODE', 'NATIONAL')])
def test_invalid_settings(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        load_settings()


def test_missing_national_dir(monkeypatch, tmp_path):
    monkeypatch.setenv('ROUTE_DATA_MODE', 'national')
    monkeypatch.setenv('ROUTE_NATIONAL_DIR', str(tmp_path / 'missing'))
    with pytest.raises(ValueError, match='ROUTE_NATIONAL_DIR'):
        load_settings()


def test_default_busan(monkeypatch):
    monkeypatch.delenv('ROUTE_DATA_MODE', raising=False)
    monkeypatch.delenv('ROUTE_WINDOW_CACHE_SIZE', raising=False)
    cfg = load_settings()
    assert cfg.data_mode == 'busan' and cfg.window_cache_size == 1


@pytest.mark.parametrize('mode', ['busan', 'national'])
def test_factory_selects_only_requested_mode(monkeypatch, tmp_path, mode):
    import app.national as N
    import runway_routing.pipeline as P
    seen = []
    monkeypatch.setattr(N, 'NationalPipeline', lambda cfg: seen.append('national'))
    monkeypatch.setattr(P, 'RoutePipeline', lambda *a, **kw: seen.append('busan'))
    _default_pipeline_factory(replace(settings(tmp_path), data_mode=mode, national_dir=tmp_path))
    assert seen == [mode]


def test_retry_once_same_inputs_and_anchor_no_retry(tmp_path):
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out([issue('OUTSIDE_CANONICAL_EXTRACT')]))
    kwargs = dict(seed=25, attempts=24, prefs={'river': 5}, shown=[[1, 2]])
    with pipe.lock:
        out = pipe.run(BODY['lat'], BODY['lon'], 5000, **kwargs)
    calls = [p.calls for s, p in built if p.calls]
    assert len(calls) == 2 and calls[0] == calls[1]
    assert not built[-1][0].small and len(pipe._windows) == 1
    assert out['issues'][0]['code'] == 'OUTSIDE_CANONICAL_EXTRACT'


def test_other_issue_no_retry_and_reuse(tmp_path):
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out([issue('OTHER')]))
    for _ in range(2):
        with pipe.lock:
            pipe.run(BODY['lat'], BODY['lon'], 5000)
    assert len(built[-1][1].calls) == 2 and len(pipe._windows) == 1


@pytest.mark.parametrize('body', [{**BODY, 'lat': 0}, {**P2P, 'end_lat': 0}])
def test_outside_national_start_or_end_wording(tmp_path, body):
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out())
    with TestClient(create_app(cfg, lambda s: pipe, background=False)) as c:
        assert c.get(READY).json()['ready']
        res = c.post(URL, json=body)
        assert res.status_code == 422 and res.json()['code'] == 'OUT_OF_AREA'
        assert '전국' in res.json()['message'] and '부산' not in res.json()['message']
    assert not any(p.calls for _, p in built)


@pytest.mark.parametrize('mode,word', [('busan', '부산'), ('national', '전국')])
def test_extract_error_wording(tmp_path, mode, word):
    if mode == 'national':
        pipe, cfg, _ = adapter(tmp_path, lambda s: loop_out([issue('OUTSIDE_CANONICAL_EXTRACT')]))
    else:
        cfg = settings(tmp_path, warmup=False)
        pipe = FakePipeline(loop_out([issue('OUTSIDE_CANONICAL_EXTRACT')]))
    with TestClient(create_app(cfg, lambda s: pipe, background=False)) as c:
        res = c.post(URL, json=BODY)
        assert res.status_code == 422 and res.json()['code'] == 'OUT_OF_AREA'
        assert word in res.json()['message']


def test_window_build_is_inside_service_lock_and_reroll_still_runs(tmp_path):
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out())
    original = pipe.builder

    def checked(*a, **kw):
        assert pipe.lock.locked()
        return original(*a, **kw)

    pipe.builder = checked
    with TestClient(create_app(cfg, lambda s: pipe, background=False)) as c:
        a = c.post(URL, json=BODY)
        b = c.post(URL, json={**BODY, 'seed': 25})
        assert a.json()['code'] == b.json()['code'] == 'NO_ROUTE'
        assert pipe.lock.acquire(blocking=False)
        pipe.lock.release()
    assert [call[1]['seed'] for _, p in built for call in p.calls] == [1, 25]


def test_failed_builder_does_not_publish_entry(tmp_path):
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out())
    def broken(*a, **kw):
        raise RuntimeError('build failed')
    pipe.builder = broken
    with pytest.raises(RuntimeError):
        pipe.run(BODY['lat'], BODY['lon'], 5000)
    assert len(pipe._windows) == 0
    assert pipe.shape_cfg == SHAPE_CFG


def test_lru_eviction_and_rebuild_determinism(tmp_path):
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out(), size=2)
    pipe.run(35.1, 129.1, 5000)
    original_key = built[-1][0].key
    pipe.run(36.1, 128.1, 5000)
    assert len(pipe._windows) == 2
    pipe.run(35.1, 129.1, 5000)
    assert list(pipe._windows)[-1] == original_key
    pipe.run(37.1, 127.1, 5000)
    assert original_key in pipe._windows
    pipe.run(36.1, 128.1, 5000)
    assert original_key not in pipe._windows
    pipe.run(35.1, 129.1, 5000)
    assert built[-1][0].key == original_key


def test_reroll_cache_hit_and_miss_same_served_routes(tmp_path):
    from test_api import GraphPipeline, _route
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out())
    def successful(*a, **kw):
        p = GraphPipeline(loop_out(baseline=[_route()]))
        p.gate = SimpleNamespace(files={})
        built.append((a[2], p))
        return p
    pipe.builder = successful
    pipe._windows.clear()
    pipe.active = None
    with TestClient(create_app(cfg, lambda s: pipe, background=False)) as c:
        assert c.post(URL, json=BODY).status_code == 200
        hit = c.post(URL, json={**BODY, 'seed': 25})
        pipe._windows.clear()  # 창 cache와 재추천 cache가 독립임을 확인
        app_engine = c.app.state.engine
        from app.reroll import ShownCache
        app_engine.reroll = ShownCache(0)
        miss = c.post(URL, json={**BODY, 'seed': 25})
        assert hit.status_code == miss.status_code == 200
        assert hit.json() == miss.json()
        assert any(call[1].get('shown') for _, p in built for call in p.calls)


def test_national_warmup_location_and_ready(tmp_path):
    from test_api import ok_pipeline
    from app.national import WARMUP_LAT, WARMUP_LON
    cfg = replace(settings(tmp_path), data_mode='national', national_dir=tmp_path)
    pipe = ok_pipeline()
    pipe.check_area = lambda *args: None
    with TestClient(create_app(cfg, lambda s: pipe, background=False)) as c:
        assert c.get(READY).json()['ready']
    assert pipe.calls[0][0][:2] == (WARMUP_LAT, WARMUP_LON)


def test_national_startup_failure_not_ready(tmp_path):
    cfg = replace(settings(tmp_path, warmup=False), data_mode='national', national_dir=tmp_path)
    def fail_factory(cfg):
        raise ValueError('bad manifest')
    with TestClient(create_app(cfg, fail_factory, background=False)) as c:
        assert c.get(READY).status_code == 503
        assert c.get(READY).json()['phase'] == 'failed'
        assert c.post(URL, json=BODY).json()['code'] == 'UNAVAILABLE'


def test_inside_coverage_but_empty_window_is_no_road(tmp_path):
    from runway_routing.national.store import NoRoad
    pipe, cfg, built = adapter(tmp_path, lambda s: loop_out())
    def empty(*args, **kwargs):
        raise NoRoad('no cells')
    pipe.builder = empty
    with TestClient(create_app(cfg, lambda s: pipe, background=False)) as c:
        r = c.post(URL, json=BODY)
        assert r.status_code == 422 and r.json()['code'] == 'NO_ROAD_NEARBY'


def test_evicted_reference_cycle_collected_before_new_build(tmp_path):
    import weakref
    refs = []
    cfg = replace(settings(tmp_path, warmup=False), data_mode='national', national_dir=tmp_path)
    def builder(*args, **kw):
        if refs:
            assert refs[-1]() is None
        p = FakePipeline()
        p.cycle = p
        refs.append(weakref.ref(p))
        return p
    pipe = NationalPipeline(cfg, store=FakeStore(), prep=object(), builder=builder)
    pipe.run(BODY['lat'], BODY['lon'], 5000)
