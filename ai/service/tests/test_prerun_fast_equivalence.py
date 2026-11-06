"""Bit equality; checkpoint-backed cases skip when artifacts are unavailable."""
import logging

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from app.models.ode import prerun_fast
from app.models.ode.odev21_legacy import model as model_module
from app.models.ode.odev21_legacy import batch as batch_module, summary as summary_module
from app.models.ode.runtime import ODEv21Runtime
from test_ode_batch_invariance import _ready_runtime

_bit_equal = prerun_fast._bit_equal
BATCH_SIZES = (1, 7, 15, 16, 17, 22, 23, 31, 32, 33, 45)


@pytest.fixture(autouse=True)
def _single_thread():
    previous = torch.get_num_threads()
    torch.set_num_threads(1)
    yield
    torch.set_num_threads(previous)


@pytest.fixture
def random_runtime():
    # Guard/cache/routing coverage must also run without downloaded artifacts.
    with torch.random.fork_rng():
        torch.manual_seed(488)
        model = model_module.V21ODE(n_groups=1)
    return ODEv21Runtime(
        model, {"mean": [0.0] * 27, "std": [1.0] * 27},
        summary_module=summary_module, batch_module=batch_module,
        model_module=model_module, fit_module=None, variant="test", checkpoint_sha256="test",
        stats_sha256="test", device="cpu", validated_horizon_sec=5400,
    )


@pytest.mark.parametrize("size", BATCH_SIZES)
def test_hybrid_integrate_identical_rows_match_eager(size):
    generator = torch.Generator().manual_seed(488)
    model = model_module.V21ODE(n_groups=1).eval()
    with torch.inference_mode():
        # Identical rows still need the original full batch shape.
        z = torch.randn(1, 12, generator=generator).expand(size, -1).contiguous()
        p = model.parameter_values(z)
        p = {name: value[:1].expand_as(value).contiguous() for name, value in p.items()}
        intensity = 100 + 60 * torch.rand(size, 41, generator=generator)
        intensity = intensity[:1].expand_as(intensity).contiguous()
        hr0 = torch.full((size,), 85.0)
        d0 = hr0 + 5.0
        expected, demand = model_module.integrate(hr0, d0, intensity, p)
        actual, last_hr, last_dem = prerun_fast._integrate(hr0, d0, intensity, p)
        assert _bit_equal(actual, expected)
        assert _bit_equal(last_hr, expected[:, -1])
        assert _bit_equal(last_dem, demand[:, -1])
        assert _bit_equal(prerun_fast.integrate(hr0, d0, intensity, p, model_module), expected)
        # Independent parameters and initial states retain the same row order.
        p = model.parameter_values(torch.randn(size, 12, generator=generator))
        hr0 = 35 + 185 * torch.rand(size, generator=generator)
        d0 = 60 + 100 * torch.rand(size, generator=generator)
        expected, _ = model_module.integrate(hr0, d0, intensity, p)
        assert _bit_equal(prerun_fast.integrate(hr0, d0, intensity, p, model_module), expected)


@pytest.mark.parametrize("size", BATCH_SIZES)
@pytest.mark.parametrize("seed", range(10))
def test_hybrid_integrate_random_model_bounds_are_exact(size, seed):
    # Concatenating pow inputs can change SIMD/tail positions and break equality.
    generator = torch.Generator().manual_seed(seed)
    p = {name: low + (high - low) * torch.rand(size, generator=generator)
         for name, (low, high) in model_module.BOUNDS.items()}
    intensity = 40 + 190 * torch.rand(size, 120, generator=generator)
    hr0 = 40 + 170 * torch.rand(size, generator=generator)
    hr0[::3] = p["hr_min"][::3] - 10
    hr0[1::3] = p["hr_max"][1::3] + 10
    d0 = 40 + 190 * torch.rand(size, generator=generator)
    with torch.inference_mode():
        expected, demand = model_module.integrate(hr0, d0, intensity, p)
        actual, last_hr, last_dem = prerun_fast._integrate(hr0, d0, intensity, p)
        assert _bit_equal(actual, expected)
        assert _bit_equal(last_hr, expected[:, -1])
        assert _bit_equal(last_dem, demand[:, -1])
        assert _bit_equal(prerun_fast.integrate(hr0, d0, intensity, p, model_module), expected)


@pytest.mark.parametrize("size", [1, 5, 22, 23])
@pytest.mark.parametrize("personalized", [False, True])
def test_runtime_predictions_are_exact_with_warm_cache(monkeypatch, size, personalized):
    runtime = _ready_runtime(monkeypatch)
    monkeypatch.setenv("ODEV21_PRERUN_FAST", "true")
    rng = np.random.default_rng(488)
    speeds = [rng.uniform(1.5, 4.5, 12 + i % 5).tolist() for i in range(size)]
    grades = [rng.uniform(-5, 5, len(row)).tolist() for row in speeds]
    personal = ({"p4": [0.1, -0.2, 0.3, 0.4],
                 "history8": rng.normal(size=(8, 5)).tolist(),
                 "summaryU": {"warmRise30Sec": 10.0}} if personalized else None)
    items = runtime._items(speeds, grades, personal, 85.0)
    for max_steps in (None, 35):
        expected = runtime._predict_items(items, max_steps=max_steps, fast=False)
        actual = runtime._predict_items(items, max_steps=max_steps, fast=True)
        assert runtime._prerun_fast.checked and not runtime._prerun_fast.disabled
        assert _bit_equal(actual, expected)
        assert _bit_equal(runtime._predict_items(items, max_steps=max_steps, fast=True), expected)


@pytest.mark.parametrize("value", ["false", "0", "no", "off", " OFF "])
def test_env_disables_fast_path(monkeypatch, value, random_runtime):
    runtime = random_runtime
    monkeypatch.setenv("ODEV21_PRERUN_FAST", value)
    def forbidden(*args):
        pytest.fail("disabled fast path was called")
    monkeypatch.setattr(runtime._prerun_fast, "predict", forbidden)
    items = runtime._items([[3.0] * 4], [[0.0] * 4], None, 85.0)
    assert _bit_equal(runtime._predict_items(items, fast=True), runtime._predict_items(items))


def test_self_check_mismatch_disables_permanently(monkeypatch, caplog, random_runtime):
    runtime = random_runtime
    monkeypatch.setenv("ODEV21_PRERUN_FAST", "true")
    fast = runtime._prerun_fast
    original = fast.forward
    monkeypatch.setattr(fast, "forward", lambda batch: original(batch) + 1.0)
    items = runtime._items([[3.0] * 4] * 5, [[0.0] * 4] * 5, None, 85.0)
    expected = runtime._predict_items(items)
    with caplog.at_level(logging.WARNING):
        assert _bit_equal(runtime._predict_items(items, fast=True), expected)
        assert _bit_equal(runtime._predict_items(items, fast=True), expected)
    assert fast.disabled
    assert len([r for r in caplog.records if "ODEV21_PRERUN_FAST" in r.message]) == 1


def test_full_forward_cache_keys_retain_shapes_and_changed_inputs(monkeypatch, random_runtime):
    runtime = random_runtime
    monkeypatch.delenv("ODEV21_PRERUN_FAST", raising=False)
    with torch.inference_mode():
        # Alternate batch sizes, then return to each warm shape; no cross-shape
        # reuse is valid even when every row represents the same person.
        for size in (1, 5, 22, 23, 5, 1):
            items = runtime._items([[3.0] * 5] * size, [[0.0] * 5] * size, None, 85.0)
            batch = runtime.batch.collate(items, runtime.stats)
            for field in (None, "p4", "history", "u_vals", "today_window", "today_summary", "time"):
                changed = {key: value.clone() for key, value in batch.items()}
                if field:
                    changed[field].reshape(-1)[0] += 0.125
                expected = runtime.model(changed)["heart_rate"]
                assert _bit_equal(runtime._prerun_fast.predict(changed), expected)
                assert _bit_equal(runtime._prerun_fast.predict(changed), expected)
        assert runtime._prerun_fast.checked and not runtime._prerun_fast.disabled


def test_cache_is_bounded_lru_and_separates_shape_dtype_and_bytes(random_runtime):
    fast = random_runtime._prerun_fast
    calls = []
    def cached(value):
        def compute():
            calls.append(value.clone())
            return value.clone()
        return fast._cached("person", {"x": value}, ("x",), compute)
    base = torch.tensor([[1.0, 2.0]])
    assert _bit_equal(cached(base), base)
    assert _bit_equal(cached(base.clone()), base)
    assert len(calls) == 1
    cached(base.reshape(2, 1))
    cached(base.double())
    cached(base + 1)
    assert len(calls) == 4
    # Fill this kind's 32 entries, touch the oldest, then evict the next oldest.
    for i in range(28):
        cached(torch.tensor([float(i)]))
    cached(base)
    cached(torch.tensor([100.0]))
    before = len(calls)
    cached(base)
    assert len(calls) == before
    cached(base.reshape(2, 1))
    assert len(calls) == before + 1
    assert len(fast._caches["person"]) == 32


@pytest.mark.parametrize("left,right,expected", [
    ([float("nan"), 1.0], [float("nan"), 1.0], True),
    ([float("nan"), 1.0], [1.0, float("nan")], False),
    ([float("nan")], [1.0], False),
    ([0.0], [-0.0], True),
    ([1.0], [1.0000001192092896], False),
    ([float("inf")], [float("inf")], True),
    ([float("inf")], [-float("inf")], False),
    ([1.0], [[1.0]], False),
])
def test_bit_equal_requires_exact_values_shapes_and_nan_positions(left, right, expected):
    assert _bit_equal(torch.tensor(left), torch.tensor(right)) is expected


@pytest.mark.parametrize("guard", ["hr0_head", "subclass"])
def test_unsupported_model_uses_original_forward(monkeypatch, random_runtime, guard):
    runtime = random_runtime
    monkeypatch.setenv("ODEV21_PRERUN_FAST", "true")
    items = runtime._items([[3.0] * 4], [[0.0] * 4], None, 85.0)
    if guard == "subclass":
        class Derived(model_module.V21ODE):
            pass
        runtime.model.__class__ = Derived
    else:
        runtime.hr0_head = True
    def forbidden(*args):
        pytest.fail("unsupported model entered fast path")
    monkeypatch.setattr(runtime._prerun_fast, "predict", forbidden)
    assert _bit_equal(runtime._predict_items(items, fast=True), runtime._predict_items(items))


def test_self_check_runs_only_once(monkeypatch, random_runtime):
    runtime = random_runtime
    monkeypatch.setenv("ODEV21_PRERUN_FAST", "true")
    fast = runtime._prerun_fast
    original = fast._self_check
    checks = []
    def observe(batch):
        checks.append(True)
        return original(batch)
    monkeypatch.setattr(fast, "_self_check", observe)
    items = runtime._items([[3.0] * 4], [[0.0] * 4], None, 85.0)
    expected = runtime._predict_items(items)
    for _ in range(3):
        assert _bit_equal(runtime._predict_items(items, fast=True), expected)
    assert checks == [True]
    assert not fast.disabled


def test_only_pre_run_adapter_opts_into_fast_path(monkeypatch, random_runtime):
    from app.planner import prerun_planner as pp

    runtime = random_runtime
    monkeypatch.setenv("ODEV21_PRERUN_FAST", "true")
    original = runtime._predict_items
    modes = []
    def observe(items, *, max_steps=None, fast=False):
        modes.append(fast)
        return original(items, max_steps=max_steps, fast=fast)
    monkeypatch.setattr(runtime, "_predict_items", observe)
    runtime.pre_run_predictor().simulate_pre_run(pp.PreRunSimulationRequest(
        candidates=(pp.PaceCandidate(0.0, (1000.0 / 3.0,), 120.0),),
        future_speed_mps=((3.0,) * 4,),
        future_grade_pct=((0.0,) * 4,), sample_interval_s=30, hr0_bpm=None, personalized=False,
    ))
    runtime.forecast_running(current_hr_bpm=90.0, speed_mps=3.0, grade_percent=0.0, horizon_sec=120)
    assert modes == [True, False]


@pytest.mark.parametrize("fallback", ["bound", "dtype", "parameter_dtype", "grad"])
def test_integrate_falls_back_without_changing_values(monkeypatch, fallback):
    if fallback == "bound":
        monkeypatch.setattr(model_module, "BOUND_RULE", "trap")
    def forbidden(*args):
        pytest.fail("unsupported input entered hybrid integration")
    monkeypatch.setattr(prerun_fast, "_integrate", forbidden)
    with torch.inference_mode():
        model = model_module.V21ODE(n_groups=1).eval()
        p = model.parameter_values(torch.zeros(5, 12))
        hr0 = torch.full((5,), 35.0)
        intensity = torch.full((5, 12), 130.0)
        if fallback == "dtype":
            hr0, intensity = hr0.double(), intensity.double()
            p = {name: value.double() for name, value in p.items()}
        elif fallback == "parameter_dtype":
            p["A"] = p["A"].double()
        elif fallback == "grad":
            hr0.requires_grad_(True)
        expected, _ = model_module.integrate(hr0, hr0, intensity, p)
        assert _bit_equal(prerun_fast.integrate(hr0, hr0, intensity, p, model_module), expected)


def test_random_integrator_self_check_mismatch_disables_fast_path(monkeypatch, caplog, random_runtime):
    runtime = random_runtime
    monkeypatch.setenv("ODEV21_PRERUN_FAST", "true")
    original = prerun_fast._integrate
    sizes = []
    def corrupt_large_batch(hr0, d0, intensity, p):
        sizes.append(intensity.shape[0])
        trajectory, hr, dem = original(hr0, d0, intensity, p)
        if intensity.shape == (45, 120):
            trajectory = trajectory + 1.0
        return trajectory, hr, dem
    monkeypatch.setattr(prerun_fast, "_integrate", corrupt_large_batch)
    items = runtime._items([[3.0] * 4], [[0.0] * 4], None, 85.0)
    expected = runtime._predict_items(items)
    with caplog.at_level(logging.WARNING):
        for _ in range(2):
            assert _bit_equal(runtime._predict_items(items, fast=True), expected)
    assert set(BATCH_SIZES).issubset(sizes)
    assert runtime._prerun_fast.disabled
    assert len([r for r in caplog.records if "ODEV21_PRERUN_FAST" in r.message]) == 1
