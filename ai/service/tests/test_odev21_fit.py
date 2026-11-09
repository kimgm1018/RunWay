"""P4 적합의 같은 seed 결과가 바이트 단위로 유지되는지 확인한다."""
import importlib
from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest
import torch


class TinyP4Model(torch.nn.Module):
    def forward(self, value):
        prediction = value["p4"][:, :1].expand_as(value["y"])
        return {"heart_rate": prediction, "z": torch.zeros_like(prediction)}


def _items(batch_module, history_module, summary_module):
    prep = {
        "n_cell": 2,
        "cell_speed": np.asarray([3.0, 3.2], dtype=np.float64),
        "cell_grade": np.asarray([0.0, 1.0], dtype=np.float64),
        "hr5": np.asarray([110.0, 111.0, 112.0, 113.0, 114.0, 115.0, 116.0, 117.0,
                            118.0, 119.0, 120.0, 121.0, 122.0], dtype=np.float64),
        "sp5": np.asarray([0.0] + [3.0] * 12, dtype=np.float64),
        "gr5": np.asarray([0.0] + [0.0] * 12, dtype=np.float64),
    }
    record = SimpleNamespace(prep=prep)
    context = SimpleNamespace(history=history_module.SENTINEL.copy(), u_raw=summary_module.aggregate([], float("nan")))
    item = batch_module.Item(rec=record, r0=0, ctx=context, group_index=-1, drop=np.zeros(4, dtype=bool))
    return {"user": [item]}


def _reference_fit_p4(model, items_by_group, stats, batch_module, training_module, model_module,
                     fit_module, *, lr, lam, steps, per_step, seed, device):
    """개선 전 fit_p4를 복사한 기준 구현."""
    groups = sorted(group for group, items in items_by_group.items() if items)
    group_seeds = {}
    rngs = [np.random.default_rng([seed, group_seeds.get(group, fit_module.group_seed(group))])
            for group in groups]
    p4 = torch.zeros(len(groups), model_module.P4_DIM, device=device, requires_grad=True)
    optimizer = torch.optim.Adam([p4], lr=lr)
    flags = [parameter.requires_grad for parameter in model.parameters()]
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    model.eval()
    snapshots = {}
    try:
        for step in range(1, max(steps) + 1):
            items, owners = [], []
            for group_index, group in enumerate(groups):
                group_items = items_by_group[group]
                for item_index in rngs[group_index].choice(
                    len(group_items), size=min(per_step, len(group_items)), replace=False
                ):
                    items.append(replace(group_items[item_index],
                                         p4=np.zeros(model_module.P4_DIM, np.float32),
                                         drop=np.zeros(4, bool)))
                    owners.append(group_index)
            batch = training_module.to_device(batch_module.collate(items, stats), device)
            batch["p4"] = p4[torch.tensor(owners, device=device)]
            output = model(batch)
            loss, _ = model_module.apple_loss(
                output["heart_rate"], batch["y"], batch["mask"], output["z"], weight=batch["weight"])
            loss = loss + lam * p4.square().sum()
            if not torch.isfinite(loss):
                raise RuntimeError("P4 적합 손실이 유한하지 않다")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            if step in steps:
                snapshots[step] = {
                    group: p4[group_index].detach().cpu().numpy().astype(np.float32).copy()
                    for group_index, group in enumerate(groups)
                }
    finally:
        for parameter, required_grad in zip(model.parameters(), flags):
            parameter.requires_grad_(required_grad)
    return snapshots


@pytest.mark.parametrize("variant", ["odev21_legacy"])
def test_fit_p4_same_seed_produces_identical_snapshot_bytes(variant):
    batch_module = importlib.import_module(f"app.models.ode.{variant}.batch")
    fit_module = importlib.import_module(f"app.models.ode.{variant}.fit")
    history_module = importlib.import_module(f"app.models.ode.{variant}.history")
    summary_module = importlib.import_module(f"app.models.ode.{variant}.summary")
    model_module = importlib.import_module(f"app.models.ode.{variant}.model")
    training_module = importlib.import_module(f"app.models.ode.{variant}.training")
    stats = summary_module.identity_stats()
    seed_args = dict(lr=0.03, lam=0.1, steps=(100,), per_step=1, seed=1729, device="cpu")

    expected = _reference_fit_p4(
        TinyP4Model(), _items(batch_module, history_module, summary_module), stats, batch_module,
        training_module, model_module, fit_module, **seed_args)
    first = fit_module.fit_p4(
        TinyP4Model(), _items(batch_module, history_module, summary_module), stats, **seed_args)
    second = fit_module.fit_p4(
        TinyP4Model(), _items(batch_module, history_module, summary_module), stats, **seed_args)

    assert expected[100]["user"].tobytes() == first[100]["user"].tobytes()
    assert first[100]["user"].tobytes() == second[100]["user"].tobytes()


@pytest.fixture
def fit_problem():
    package = "app.models.ode.odev21_legacy"
    batch = importlib.import_module(package + ".batch")
    history = importlib.import_module(package + ".history")
    summary = importlib.import_module(package + ".summary")
    fit = importlib.import_module(package + ".fit")
    return fit, _items(batch, history, summary), summary.identity_stats()


def test_fit_p4_init_is_first_model_input_and_unchanged_at_zero_lr(fit_problem):
    fit, items, stats = fit_problem
    initial = np.asarray([1.0, -2.0, 3.0, -4.0], np.float32)
    seen = []

    class RecordingModel(TinyP4Model):
        def forward(self, value):
            seen.append(value["p4"].detach().cpu().numpy().copy())
            return super().forward(value)

    info = {}
    snapshots = fit.fit_p4(RecordingModel(), items, stats, lr=0, lam=0.1, steps=(1,),
                           init={"user": initial}, info=info)
    np.testing.assert_array_equal(seen[0][0], initial)
    np.testing.assert_array_equal(snapshots[1]["user"], initial)
    assert info == {"steps_run": 1}


def test_fit_p4_missing_init_group_starts_at_zero(fit_problem):
    fit, items, stats = fit_problem
    snapshots = fit.fit_p4(TinyP4Model(), items, stats, lr=0, lam=0, steps=(1,), init={})
    np.testing.assert_array_equal(snapshots[1]["user"], np.zeros(4, np.float32))


def test_fit_p4_early_stop_fills_remaining_snapshots(fit_problem):
    fit, items, stats = fit_problem

    class FlatModel(TinyP4Model):
        def forward(self, value):
            prediction = value["p4"][:, :1].expand_as(value["y"]) * 0
            return {"heart_rate": prediction, "z": torch.zeros_like(prediction)}

    info = {}
    snapshots = fit.fit_p4(FlatModel(), items, stats, lr=0.03, lam=0, steps=(1, 10, 30),
                           early_stop_tol=1e-6, early_stop_min_steps=3,
                           early_stop_patience=2, info=info)
    assert info["steps_run"] == 4
    assert set(snapshots) == {1, 10, 30}
    for snapshot in snapshots.values():
        np.testing.assert_array_equal(snapshot["user"], np.zeros(4, np.float32))
    assert snapshots[10]["user"] is not snapshots[30]["user"]


def test_fit_p4_early_stop_checks_all_groups(fit_problem):
    fit, items, stats = fit_problem
    items["other"] = items["user"]

    class OneMovingGroup(TinyP4Model):
        def forward(self, value):
            prediction = value["p4"][:, :1].expand_as(value["y"])
            prediction = prediction * torch.tensor([[0.0], [1.0]])
            return {"heart_rate": prediction, "z": torch.zeros_like(prediction)}

    info = {}
    fit.fit_p4(OneMovingGroup(), items, stats, lr=0.03, lam=0, steps=(5,),
               early_stop_tol=1e-6, early_stop_min_steps=1, early_stop_patience=1, info=info)
    assert info["steps_run"] == 5


def test_fit_p4_info_reports_full_run_with_early_stop_disabled(fit_problem):
    fit, items, stats = fit_problem
    info = {}
    fit.fit_p4(TinyP4Model(), items, stats, lr=0, lam=0, steps=(7,), info=info)
    assert info["steps_run"] == 7
