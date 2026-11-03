"""ODE v2.1 serving loader and adapters for AI04/AI05.

The selected 2026-11-01 checkpoint predates Amendment 2 (27 summary features,
no HR0 head). The model version and feature count select the matching vendored
implementation; replacing the checkpoint and its stats by environment settings
selects the Amendment 2 implementation without code changes.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np

from app.planner import prerun_planner as pp

# 출발 전 ODE 검증 지평 기본값(90분)과 근거. env ODEV21_VALIDATED_HORIZON_SEC / ODEV21_VALIDATION_REF로 바꾼다.
DEFAULT_VALIDATED_HORIZON_SEC = 5400
DEFAULT_VALIDATION_REF = "ODE v2.1 1차 base pre-run H*90, C60 vs B_THS_pers 승"

DEFAULT_CHECKPOINT_SHA256 = "ba767a645c2b1180a3ced3cbcc533142544d3e34cc69b23aed28eba134b14061"
DEFAULT_STATS_SHA256 = "9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066"

# v6_8_1: 기본 파일명을 배포 이름(infra/ai/.env.example, test-artifacts)과 하나로 맞춘다.
# 예전 기본 이름(model_epoch_020.pt, summary_stats.json)으로 받아 둔 로컬 설치는 env가 없을 때만 그대로 읽는다.
DEFAULT_CHECKPOINT_PATH = "models/ode/ode_epoch_020.pt"
DEFAULT_STATS_PATH = "models/ode/ode_summary_stats.json"
LEGACY_CHECKPOINT_PATH = "models/ode/model_epoch_020.pt"
LEGACY_STATS_PATH = "models/ode/summary_stats.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _service_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else Path(__file__).resolve().parents[3] / path


def _default_or_env_path(env_name: str, default: str, legacy: str) -> Path:
    """env가 있으면 그 값만 쓴다(기존 동작). 없으면 새 기본 이름, 그 파일이 없고 예전 이름만 있으면 예전 이름."""
    value = os.getenv(env_name)
    if value is not None:
        return _service_path(value)
    path = _service_path(default)
    legacy_path = _service_path(legacy)
    return legacy_path if not path.is_file() and legacy_path.is_file() else path


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


@dataclass(frozen=True)
class ODEModelInfo:
    model_type: str
    model_version: str
    variant: str
    checkpoint_sha256: str
    summary_feature_count: int
    summary_stats_sha256: str
    device: str
    hr0_head: bool
    validated_horizon_sec: int
    sample_interval_sec: int = 30
    horizons_sec: tuple[int, ...] = (30, 60, 120)


class ODEv21Runtime:
    """Small online adapter over the vendored ODE v2.1 research implementation."""

    def __init__(self, model, stats: dict, *, summary_module, batch_module, model_module, fit_module,
                 variant: str, checkpoint_sha256: str, stats_sha256: str,
                 device: str, validated_horizon_sec: int) -> None:
        import torch

        self.torch = torch
        self.model = model.to(device).eval()
        self.stats = {"mean": np.asarray(stats["mean"], np.float32),
                      "std": np.asarray(stats["std"], np.float32)}
        self.summary = summary_module
        self.batch = batch_module
        self.model_module = model_module
        self.fit_module = fit_module
        self.device = device
        self.hr0_head = bool(getattr(model, "hr0_head_enabled", False))
        self.horizon_sec = max(0, int(validated_horizon_sec))
        self.info = ODEModelInfo(
            model_type="ODE-v2.1", model_version=f"{variant}:{checkpoint_sha256[:12]}",
            variant=variant, checkpoint_sha256=checkpoint_sha256,
            summary_feature_count=int(len(self.stats["mean"])), summary_stats_sha256=stats_sha256,
            device=device, hr0_head=self.hr0_head, validated_horizon_sec=self.horizon_sec)

    @classmethod
    def from_environment(cls) -> "ODEv21Runtime | None":
        checkpoint = _default_or_env_path("ODEV21_CHECKPOINT_PATH", DEFAULT_CHECKPOINT_PATH, LEGACY_CHECKPOINT_PATH)
        stats_path = _default_or_env_path("ODEV21_SUMMARY_STATS_PATH", DEFAULT_STATS_PATH, LEGACY_STATS_PATH)
        if not checkpoint.is_file() or not stats_path.is_file():
            return None

        expected_ck = os.getenv("ODEV21_CHECKPOINT_SHA256", DEFAULT_CHECKPOINT_SHA256).strip().lower()
        expected_stats = os.getenv("ODEV21_SUMMARY_STATS_SHA256", DEFAULT_STATS_SHA256).strip().lower()
        checkpoint_sha, stats_sha = _sha256(checkpoint), _sha256(stats_path)
        if not expected_ck or checkpoint_sha != expected_ck:
            raise ValueError("ODE checkpoint SHA256 mismatch")
        if not expected_stats or stats_sha != expected_stats:
            raise ValueError("ODE summary stats SHA256 mismatch")

        import torch

        state = torch.load(checkpoint, map_location="cpu", weights_only=False)
        config = dict(state.get("config") or {})
        data = json.loads(stats_path.read_text(encoding="utf-8"))
        stats = {"mean": data["mean"], "std": data["std"]}
        feature_count = len(stats["mean"])
        if len(stats["std"]) != feature_count:
            raise ValueError("ODE summary stats mean/std lengths differ")
        if feature_count == 27 and "hr0_head" not in config:
            from app.models.ode.odev21_legacy import batch as batch_module
            from app.models.ode.odev21_legacy import fit as fit_module
            from app.models.ode.odev21_legacy import model as model_module
            from app.models.ode.odev21_legacy import summary as summary_module
            model = model_module.V21ODE(**config)
            default_variant = "ode_v21_base_epoch20_legacy27"
        else:
            raise ValueError(f"Unsupported ODE checkpoint shape: {feature_count} features/config={sorted(config)}")
        model.load_state_dict(state["model"], strict=True)

        requested_device = os.getenv("ODEV21_DEVICE", "cpu").strip().lower()
        if requested_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("ODEV21_DEVICE=cuda but CUDA is unavailable")
        if requested_device not in {"cuda", "cpu"}:
            raise ValueError("ODEV21_DEVICE must be cuda or cpu")
        torch.set_num_threads(max(1, int(os.getenv("ODEV21_TORCH_THREADS", "1"))))
        return cls(model, stats, summary_module=summary_module, batch_module=batch_module,
                   model_module=model_module, fit_module=fit_module,
                   variant=os.getenv("ODEV21_VARIANT", "").strip() or default_variant,
                   checkpoint_sha256=checkpoint_sha, stats_sha256=stats_sha,
                   device=requested_device,
                   validated_horizon_sec=int(os.getenv("ODEV21_VALIDATED_HORIZON_SEC", str(DEFAULT_VALIDATED_HORIZON_SEC))))

    def warmup_adam(self) -> None:
        """Adam의 지연 import를 작은 CPU 텐서로 미리 끝낸다."""
        parameter = self.torch.zeros(1, dtype=self.torch.float32, device="cpu", requires_grad=True)
        optimizer = self.torch.optim.Adam([parameter], lr=0.01)
        optimizer.zero_grad(set_to_none=True)
        parameter.square().sum().backward()
        optimizer.step()

    def _summary_vector(self, personalization: dict | None) -> tuple[np.ndarray, np.ndarray, dict]:
        data = personalization or {}
        raw_values = data.get("summaryU") or {}
        raw = dict(raw_values) if isinstance(raw_values, dict) else {}
        if "warm_rise" not in raw:
            raw["warm_rise"] = [raw.get(f"warmRise{seconds}Sec") for seconds in range(30, 601, 30)]
        for name in self.summary.FEATURES:
            raw.setdefault(name, None)
        values, mask = self.summary.normalize(raw, self.stats)
        p4 = np.asarray(data.get("p4") or [0.0] * 4, np.float32)
        if p4.shape != (4,) or not np.isfinite(p4).all():
            p4 = np.zeros(4, np.float32)
        history = np.asarray(data.get("history8") or [], np.float32)
        if history.size == 0:
            history = self.batch.SENTINEL.copy()
        if history.ndim != 2 or history.shape[1] != 5:
            raise ValueError("personalization.history8 must have shape [n, 5]")
        if len(history) > 512 or not np.isfinite(history).all():
            raise ValueError("personalization.history8 is invalid or exceeds 512 rows")
        return p4, history, raw

    def _items(self, speed_rows, grade_rows, personalization: dict | None, hr0_sub_bpm: float,
               drop_personal_inputs: bool = False):
        from dataclasses import dataclass

        p4, history, raw = self._summary_vector(personalization)
        ctx = SimpleNamespace(history=history, u_raw=raw,
                              hr_ref=_safe_float((personalization or {}).get("hrRefBpm"), 0.0))
        items = []
        for speeds, grades in zip(speed_rows, grade_rows):
            speeds = np.asarray(speeds, np.float64)
            grades = np.asarray(grades, np.float64)
            prep = {"n_cell": len(speeds), "cell_speed": speeds, "cell_grade": grades,
                    "hr5": np.full(6 * len(speeds) + 1, np.nan), "sp5": np.zeros(6 * len(speeds) + 1),
                    "gr5": np.zeros(6 * len(speeds) + 1)}
            prep["hr5"][0] = hr0_sub_bpm
            # drop = (p4, history, summary, today). G0(empty 모드)는 앞의 셋을 비운 학습 결측 경로다.
            drop = np.array([True, True, True, False]) if drop_personal_inputs else np.zeros(4, bool)
            item_kwargs = dict(rec=SimpleNamespace(prep=prep, y10=None), r0=0, ctx=ctx,
                               group_index=-1, drop=drop, p4=p4)
            if self.hr0_head:
                item_kwargs["hr0_mask"] = True
            item = self.batch.Item(**item_kwargs)
            items.append(item)
        return items

    def _predict_items(self, items, *, max_steps: int | None = None) -> np.ndarray:
        if not items:
            return np.empty((0, 0), np.float32)
        batch = self.batch.collate(items, self.stats, max_steps=max_steps)
        batch = {key: value.to(self.device) for key, value in batch.items()}
        with self.torch.inference_mode():
            output = self.model(batch)
        n_points = output["heart_rate"].shape[1] // 3
        if n_points <= 0:
            return np.empty((len(items), 0), np.float32)
        return self.model_module.points30(output["heart_rate"], n_points).detach().cpu().numpy()

    def pre_run_predictor(self, personalization: dict | None = None,
                          support_start_hr_median_bpm: float | None = None,
                          drop_personal_inputs: bool = False):
        runtime = self
        fallback = _safe_float(support_start_hr_median_bpm, 85.0)
        if not 35 <= fallback <= 220:
            fallback = 85.0

        class Predictor:
            provider_name = "ode_v21"
            capabilities = pp.PreRunCapabilities(
                supports_pre_run_no_hr=True, supports_pre_run_hr0=True, supports_full_trajectory=True,
                supports_personalization=bool(personalization), sample_interval_s=30,
                validated_prerun_horizon_s=runtime.horizon_sec,
                validation_ref=os.getenv("ODEV21_VALIDATION_REF", DEFAULT_VALIDATION_REF))

            def simulate_pre_run(self, request: pp.PreRunSimulationRequest):
                if request.sample_interval_s != 30:
                    raise ValueError("ODE v2.1 adapter requires 30 second samples")
                speeds = request.future_speed_mps
                grades = request.future_grade_pct
                steps = max(3, max((len(row) for row in speeds), default=0) * 3) if speeds else 0
                rows = runtime._predict_items(runtime._items(speeds, grades, personalization, fallback,
                                                             drop_personal_inputs=drop_personal_inputs),
                                              max_steps=steps or None)
                return pp.PreRunSimulationResult(
                    hr_bpm=tuple(tuple(float(v) for v in row[:len(speeds[index])])
                                 for index, row in enumerate(rows)), model_name="ODE-v2.1",
                    model_version=runtime.info.model_version, personalized=bool(personalization),
                    warnings=(("HR0 미입력: Amendment 2 HR0 head를 사용한다." if runtime.hr0_head else
                               f"HR0 미입력: support 시작 HR 중앙값 {fallback:.1f} bpm(없으면 85 bpm)을 대체값으로 쓴다."),))

        return Predictor()

    def forecast_running(self, *, current_hr_bpm: float, speed_mps: float, grade_percent: float,
                         horizon_sec: int, personalization: dict | None = None) -> dict:
        """Return an ODE HR forecast over a constant remaining action; ETA is calculated by caller."""
        n_cells = max(1, min(math.ceil(max(30, horizon_sec) / 30), math.ceil(self.horizon_sec / 30)))
        speeds = [[max(0.1, _safe_float(speed_mps, 2.8))] * n_cells]
        grades = [[_safe_float(grade_percent)] * n_cells]
        p4, history, raw = self._summary_vector(personalization)
        ctx = SimpleNamespace(history=history, u_raw=raw, hr_ref=0.0)
        items = []
        for sp, gr in zip(speeds, grades):
            prep = {"n_cell": n_cells, "cell_speed": np.asarray(sp), "cell_grade": np.asarray(gr),
                    "hr5": np.full(6 * n_cells + 1, np.nan), "sp5": np.zeros(6 * n_cells + 1),
                    "gr5": np.zeros(6 * n_cells + 1)}
            prep["hr5"][0] = max(35.0, min(220.0, _safe_float(current_hr_bpm, 85.0)))
            item_kwargs = dict(rec=SimpleNamespace(prep=prep, y10=None), r0=0, ctx=ctx,
                               group_index=-1, drop=np.zeros(4, bool), p4=p4)
            items.append(self.batch.Item(**item_kwargs))
        rows = self._predict_items(items)
        curve = rows[0].tolist() if len(rows) else []
        return dict(modelName=self.info.model_type, modelVersion=self.info.model_version,
                    sampleIntervalSec=30, validatedHorizonSec=self.horizon_sec,
                    points=[dict(elapsedSec=(i + 1) * 30, hrBpm=round(float(v), 2))
                            for i, v in enumerate(curve)])


def load_ode_runtime() -> ODEv21Runtime | None:
    return ODEv21Runtime.from_environment()
