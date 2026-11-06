"""Checkpoint-free exact regression and bounded concurrency checks for S15P31E105-496."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
import torch

from app.gru_personalization import (
    CachedDbGruPersonalizationLookup, GRU_PERSONALIZATION_SCHEMA_VERSION,
    NOT_FOUND_WARNING, UNAVAILABLE_WARNING, compute_gru_personalization,
    lookup_user_personalization, support_to_frames,
)
from app.models.gru import GRUModel


@pytest.fixture
def model(monkeypatch):
    src = Path(__file__).resolve().parents[2] / "workspace/doyeon/gru/src"
    modules = {}
    # Isolate the predictor's generic import names from other model tests.
    for name in ("data", "model", "predictor"):
        module_name = "_gru_predictor_496" if name == "predictor" else name
        spec = importlib.util.spec_from_file_location(module_name, src / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, module_name, module)
        spec.loader.exec_module(module)
        modules[name] = module
    threads = torch.get_num_threads()
    torch.set_num_threads(1)
    with torch.random.fork_rng():
        torch.manual_seed(496)
        predictor = object.__new__(modules["predictor"].GRUPredictor)
        predictor.models = {
            key: modules["model"].HorizonGRU(
                n_inputs=5, hidden=16, layers=1, mask_future_grade=key == "nograde",
            ).eval() for key in ("main", "nograde")
        }
    predictor.flats = {"main": False, "nograde": True}
    predictor.device, predictor.hist, predictor.elapsed_clip = "cpu", 8, 7200
    predictor.mean = np.array([2.5, 0.0, 130.0], np.float32)
    predictor.std = np.array([0.7, 2.0, 15.0], np.float32)
    predictor.norm = object.__new__(modules["data"].Normalizer)
    columns = [*modules["data"].FEATURES, modules["data"].TARGET]
    predictor.norm.mean = pd.Series(predictor.mean, index=columns)
    predictor.norm.std = pd.Series(predictor.std, index=columns)
    predictor.model, predictor.flat = predictor.models["main"], False
    predictor.base = predictor.get_state()
    predictor.base_head = predictor.base["main"]
    try:
        yield GRUModel(predictor, "a" * 64)
    finally:
        torch.set_num_threads(threads)


def batch():
    result = []
    for i in range(4):
        result.append({
            "hr": np.array([120, np.nan, 125, 130 + i], np.float32),
            "speed": np.array([2.5, 2.6, 2.7, 2.8], np.float32),
            "grade": np.array([0, 1, -1, 2], np.float32),
            "segment_id": np.array([0, 0, 1, 1]), "elapsed_s": 1000,
            "hr0": 141.0 if i == 2 else None,
            "future_speed": np.linspace(2, 3, 24, dtype=np.float32),
            "future_grade": (None if i == 1 else
                             np.full(24, np.nan if i == 3 else i, np.float32)),
        })
    return result


def shifted(model, amount):
    return {key: (w.clone() + amount / 10, b.clone() + amount)
            for key, (w, b) in model.predictor.base.items()}


def head_json(state):
    return {key: {"weight": w.tolist(), "bias": b.tolist()} for key, (w, b) in state.items()}


def assert_state_equal(actual, expected):
    assert set(actual) == set(expected)
    for key in expected:
        for a, b in zip(actual[key], expected[key]):
            assert torch.equal(a, b)


def support_body():
    sessions = []
    for session_id in (1, 2, 3):
        samples = [SimpleNamespace(
            elapsed_sec=i * 5, hr_bpm=120 + i * 0.2 + session_id,
            speed_mps=2.5 + i * 0.001, grade_percent=0.5,
            hr_quality="GOOD", speed_quality="GOOD", grade_quality="GOOD", hr_is_filled=False,
        ) for i in range(61)]
        sessions.append(SimpleNamespace(
            session_id=session_id, session_started_at=datetime(2026, 10, session_id, tzinfo=timezone.utc),
            workout_quality="CLEAN", samples=samples,
        ))
    return SimpleNamespace(sessions=sessions)


def old_locked_personalization(body, model, limit):
    """Original per-run limit/order and locked fitting, independent of the new lock choice."""
    p = model.predictor
    with model.lock:
        batches = {key: [] for key in p.models}
        used_runs = 0
        for frame in support_to_frames(body):
            if all(sum(f[0].shape[0] for f in batches[key]) >= limit for key in p.models):
                break
            run_used = False
            for key in p.models:
                remaining = limit - sum(f[0].shape[0] for f in batches[key])
                if remaining <= 0:
                    continue
                features = p.support_features([frame], key)
                if features is not None and features[0].shape[0]:
                    batches[key].append(tuple(value[:remaining] for value in features))
                    run_used = True
            used_runs += int(run_used)
        features = {key: tuple(torch.cat([f[i] for f in parts]) for i in range(3))
                    for key, parts in batches.items()}
        state = {key: p.fit_head(p.base[key], features[key], 100, 1e-3, 0.03) for key in p.models}
        return {
            "schemaVersion": GRU_PERSONALIZATION_SCHEMA_VERSION,
            "modelVersion": model.info.model_version, "modelSha256": model.sha256,
            "supportRunCount": used_runs,
            "supportWindowCount": int(torch.any(features["main"][2] > 0, dim=1).sum()),
            "head": head_json(state),
        }, []


@pytest.mark.parametrize("as_dict", [False, True])
@pytest.mark.parametrize("strided_double", [False, True])
def test_predictions_exactly_match_old_algorithm_without_head_writes(model, as_dict, strided_double):
    p, windows = model.predictor, batch()
    if as_dict:
        windows = {key: [w[key] for w in windows] for key in
                   ("hr", "speed", "grade", "segment_id", "elapsed_s", "future_speed")}
        windows["future_grade"] = [w["future_grade"] if w["future_grade"] is not None
                                   else np.full(24, np.nan) for w in batch()]
        windows["hr0"] = [130, 131, 141, 133]
    state = shifted(model, 1.5)
    if strided_double:
        state = {key: (w.T.contiguous().T.double(), b.double()) for key, (w, b) in state.items()}
    expected_base = p.predict(windows, personalized=False)
    try:
        p.load_state(state)
        expected_user = p.predict(windows, personalized=True)
    finally:
        p.load_state(None)
    # Leave deliberately different module heads installed: the new path must neither read nor write them.
    p.load_state(shifted(model, -3))
    before = p.get_state()
    with ThreadPoolExecutor(max_workers=2) as pool:
        with model.lock:
            default = pool.submit(model.predict, windows)
            personal = pool.submit(model.predict_with_state, windows, state)
            assert np.array_equal(default.result(timeout=5), expected_base)
            assert np.array_equal(personal.result(timeout=5), expected_user)
    assert_state_equal(p.get_state(), before)
    assert model.predict([]).shape == (0, 3)
    with pytest.raises(KeyError):
        model.predict_with_state([], {"main": state["main"]})
    with pytest.raises(ValueError, match="key"):
        model.predict_with_state([], {**state, "extra": state["main"]})
    invalid = batch()
    invalid[0]["hr"][-1] = np.nan
    with pytest.raises(ValueError, match="HR0"):
        model.predict(invalid)


def test_main_only_predictor_keeps_grade_missing_fallback(model):
    p = model.predictor
    p.models.pop("nograde")
    p.base.pop("nograde")
    assert np.array_equal(model.predict(batch()), p.predict(batch(), personalized=False))


def test_personalization_payload_exactly_matches_old_locked_algorithm(model):
    before = model.predictor.get_state()
    expected = old_locked_personalization(support_body(), model, 9)
    assert compute_gru_personalization(support_body(), model, max_windows=9) == expected
    assert expected[0]["supportRunCount"] == 2
    assert_state_equal(model.predictor.get_state(), before)


def test_user_predictions_do_not_mix_while_personalization_runs(model):
    states = [shifted(model, -2), shifted(model, 3)]
    references = [model.predict_with_state(batch(), state) for state in states]
    before = model.predictor.get_state()
    barrier = threading.Barrier(9, timeout=5)

    def predict_many(user):
        barrier.wait()
        for _ in range(20):
            assert np.array_equal(model.predict_with_state(batch(), states[user]), references[user])

    def fit():
        barrier.wait()
        return compute_gru_personalization(support_body(), model, max_windows=9)

    with ThreadPoolExecutor(max_workers=9) as pool:
        futures = [pool.submit(predict_many, i % 2) for i in range(8)]
        fitting = pool.submit(fit)
        for future in futures:
            future.result(timeout=30)
        payload, warnings = fitting.result(timeout=30)
    assert payload is not None and warnings == []
    assert_state_equal(model.predictor.get_state(), before)


def test_blocked_personalization_does_not_block_predictions(model, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = model.predictor.support_features

    def slow(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(model.predictor, "support_features", slow)
    with ThreadPoolExecutor(max_workers=3) as pool:
        fitting = pool.submit(compute_gru_personalization, support_body(), model, max_windows=2)
        try:
            assert entered.wait(5)
            default = pool.submit(model.predict, batch())
            personal = pool.submit(model.predict_with_state, batch(), shifted(model, 2))
            assert default.result(timeout=2).shape == (4, 3)
            assert personal.result(timeout=2).shape == (4, 3)
            assert not fitting.done()
        finally:
            release.set()
        assert fitting.result(timeout=10)[1] == []


def row_for(model, user):
    return {"schema_version": GRU_PERSONALIZATION_SCHEMA_VERSION,
            "model_sha256": model.sha256, "personalization_version": user,
            "head_json": head_json(shifted(model, user))}


class FakeDb:
    def __init__(self, model):
        self.model = model
        self.calls = Counter()
        self.lock = threading.Lock()
        self.entered, self.release = threading.Event(), threading.Event()
        self.block_user = None

    def fetch_one_with_timeout(self, _sql, params, _timeout):
        user = params["user_id"]
        with self.lock:
            self.calls[user] += 1
        if user == self.block_user:
            self.entered.set()
            assert self.release.wait(5)
        return row_for(self.model, user)


def test_cache_keeps_concurrent_users_separate(model):
    db = FakeDb(model)
    lookup = CachedDbGruPersonalizationLookup(db)
    users = [1, 2] * 30
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(lookup.get_for_model, user, model) for user in users]
        results = [future.result(timeout=10) for future in futures]
    for user, result in zip(users, results):
        assert result.warning is None and result.personalization_version == user
        assert_state_equal(result.state, shifted(model, user))
    assert db.calls == {1: 1, 2: 1}


def test_slow_db_does_not_block_other_users_hit_or_miss(model):
    db = FakeDb(model)
    lookup = CachedDbGruPersonalizationLookup(db)
    lookup.get_for_model(2, model)
    db.block_user = 1
    with ThreadPoolExecutor(max_workers=3) as pool:
        slow = pool.submit(lookup.get_for_model, 1, model)
        try:
            assert db.entered.wait(5)
            assert pool.submit(lookup.get_for_model, 2, model).result(timeout=2).personalization_version == 2
            assert pool.submit(lookup.get_for_model, 5, model).result(timeout=2).personalization_version == 5
            assert not slow.done()
        finally:
            db.release.set()
        assert slow.result(timeout=5).personalization_version == 1


@pytest.mark.parametrize("raises", [False, True])
def test_same_user_single_flight_shares_result_or_exception(model, monkeypatch, raises):
    db = FakeDb(model)
    # No cache: waiters must consume the in-flight result rather than retrying DB.
    lookup = CachedDbGruPersonalizationLookup(db, max_users=0)
    entered, release, waiter_entered = threading.Event(), threading.Event(), threading.Event()
    calls = []

    def get_latest(user):
        calls.append(user)
        entered.set()
        assert release.wait(5)
        if raises:
            raise RuntimeError("fake adapter failure")
        return row_for(model, user), None, True

    monkeypatch.setattr(lookup.adapter, "get_latest", get_latest)
    user = 4 if raises else 3
    with ThreadPoolExecutor(max_workers=2) as pool:
        leader = pool.submit(lookup_user_personalization, lookup, user, model)
        try:
            assert entered.wait(5)
            # Observe the wait itself so release cannot race ahead of the second miss.
            flight = lookup._inflight[user]
            original_result = flight.result

            def waiting(*args, **kwargs):
                waiter_entered.set()
                kwargs.setdefault("timeout", 5)
                return original_result(*args, **kwargs)

            monkeypatch.setattr(flight, "result", waiting)
            waiter = pool.submit(lookup_user_personalization, lookup, user, model)
            assert waiter_entered.wait(5)
        finally:
            release.set()
        results = [leader.result(timeout=5), waiter.result(timeout=5)]
    assert calls == [user] and not lookup._inflight
    for result in results:
        if raises:
            assert result.warning == UNAVAILABLE_WARNING
        else:
            assert result.personalization_version == user
            assert_state_equal(result.state, shifted(model, user))
    if raises:
        monkeypatch.setattr(lookup.adapter, "get_latest", lambda user: (row_for(model, user), None, True))
        assert lookup.get_for_model(user, model).personalization_version == user


def test_unavailable_is_not_cached_and_ttl_lru_are_preserved(model, monkeypatch):
    db = FakeDb(model)
    now = [10.0]
    lookup = CachedDbGruPersonalizationLookup(db, ttl_sec=10, empty_ttl_sec=2,
                                             max_users=2, monotonic=lambda: now[0])
    calls = []

    def unavailable(user):
        calls.append(user)
        return None, UNAVAILABLE_WARNING, False

    with monkeypatch.context() as patch:
        patch.setattr(lookup.adapter, "get_latest", unavailable)
        for _ in range(2):
            assert lookup.get_for_model(4, model).warning == UNAVAILABLE_WARNING
    assert calls == [4, 4] and not lookup._cache and not lookup._inflight
    for user in (1, 2, 1, 3):
        lookup.get_for_model(user, model)
    assert list(lookup._cache) == [1, 3]
    now[0] = 20.0
    lookup.get_for_model(1, model)
    assert db.calls[1] == 2
    with monkeypatch.context() as patch:
        patch.setattr(lookup.adapter, "get_latest", lambda user: (None, NOT_FOUND_WARNING, True))
        assert lookup.get_for_model(9, model).warning == NOT_FOUND_WARNING
        assert lookup._cache[9][0] == 22.0


def test_fake_predictor_keeps_locked_prediction_and_restores_after_failure():
    class Predictor:
        hist = 8

        def __init__(self):
            self.state = None

        def load_state(self, state):
            assert model.lock.locked()
            self.state = state

        def predict(self, batch, personalized):
            assert model.lock.locked()
            if personalized:
                raise ValueError("fake failure")
            return np.zeros((1, 3), np.float32)

    p = Predictor()
    model = GRUModel(p, "a" * 64)
    assert model.predict({}).shape == (1, 3)
    with pytest.raises(ValueError, match="fake failure"):
        model.predict_with_state({}, {})
    assert p.state is None and not model.lock.locked()


def test_fake_personalization_keeps_shared_lock(model):
    p = model.predictor

    def support(*args):
        assert fallback.lock.locked()
        return p.support_features(*args)

    def fit(*args):
        assert fallback.lock.locked()
        return p.fit_head(*args)

    fake = SimpleNamespace(hist=p.hist, models=p.models, base=p.base,
                           support_features=support, fit_head=fit)
    fallback = GRUModel(fake, model.sha256)
    expected = old_locked_personalization(support_body(), model, 2)
    assert compute_gru_personalization(support_body(), fallback, max_windows=2) == expected
