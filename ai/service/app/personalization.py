"""Build versioned ODE personalization from backend supplied support sessions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import os
from types import SimpleNamespace

import numpy as np
import pandas as pd

from app.inference import ApiError
from app.grade_fill import prepare_with_grade_fallback
from app.models.ode.validation import pv_data


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (tuple, list, np.ndarray)):
        return [_json_safe(v) for v in list(value)]
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if np.isfinite(number) else None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    return value


def _records(body, runtime):
    # 서비스는 27특징 legacy checkpoint만 불러온다(runtime 로더가 다른 모양을 거부한다).
    import importlib
    package_name = "app.models.ode.odev21_legacy"
    package = importlib.import_module(package_name)
    cells = importlib.import_module(package_name + ".cells")
    history = importlib.import_module(package_name + ".history")
    summary = importlib.import_module(package_name + ".summary")
    model_user_key = str(body.user_id)
    records, start_hrs, fill_info = [], [], []
    for session in body.sessions:
        samples = session.samples
        frame = pd.DataFrame([{
            "session_id": session.session_id,
            "segment_id": 0,
            "elapsed_s": s.elapsed_sec,
            "hr_bpm": np.nan if s.hr_bpm is None else s.hr_bpm,
            "speed_mps": np.nan if s.speed_mps is None else s.speed_mps,
            "grade_observed_pct": np.nan if s.grade_percent is None else s.grade_percent,
            "hr_quality": s.hr_quality if s.hr_bpm is not None else "MISSING",
            "speed_quality": s.speed_quality if s.speed_mps is not None else "MISSING",
            "grade_quality": s.grade_quality if s.grade_percent is not None else "MISSING",
            "hr_is_filled": s.hr_is_filled,
        } for s in samples], columns=pv_data.TS_COLUMNS)
        frame = frame.sort_values(["segment_id", "elapsed_s"], kind="stable").reset_index(drop=True)
        if frame.elapsed_s.duplicated().any() or not np.isclose(frame.elapsed_s.iloc[0], 0.0):
            raise ApiError(400, "VALIDATION_ERROR", "support sample elapsedSec는 0초부터 중복 없이 이어져야 합니다.",
                           [{"name": "sessions.samples.elapsedSec", "reason": "canonical 5초 행이 필요합니다"}])
        intervals = np.diff(frame.elapsed_s.to_numpy(float))
        if len(intervals) and not np.allclose(intervals, 5.0):
            raise ApiError(400, "VALIDATION_ERROR", "support sample 간격은 5초여야 합니다.",
                           [{"name": "sessions.samples.elapsedSec", "reason": "5초 간격이 아닙니다"}])
        frame, prepared, grade_fill = prepare_with_grade_fallback(frame)
        if isinstance(prepared, str):
            continue
        summ = summary.run_summary(frame)
        n_cell = int(prepared["n_cell"])
        measured = cells.measured_hr(frame)[:6 * n_cell + 1]
        hr = frame.hr_bpm.to_numpy(np.float64)[:6 * n_cell + 1]
        prep = {key: prepared[key] for key in ("hr0", "fa", "E", "n_cell", "cell_speed", "cell_grade")}
        prep["hr5"] = np.where(measured, hr, np.nan)
        prep["sp5"] = np.concatenate([[0.0], np.asarray(prepared["speed_rows"], np.float64)])
        prep["gr5"] = np.concatenate([[0.0], np.asarray(prepared["grade_rows"], np.float64)])
        hist_rows = history.session_history_rows(frame)
        start = session.session_started_at
        if start.tzinfo is None or start.utcoffset() is None:
            raise ApiError(400, "VALIDATION_ERROR", "sessionStartedAt에는 시간대가 있어야 합니다.")
        start = start.astimezone(timezone.utc)
        end_s = start.timestamp() + float(frame.elapsed_s.max())
        rec = SimpleNamespace(session_id=session.session_id, group=model_user_key, key="support", start=start,
                              start_s=start.timestamp(), end_hist=start + timedelta(seconds=float(frame.elapsed_s.max())),
                              end_s=end_s,
                              usable=bool(session.workout_quality in summary.USABLE and summ["hr_n"] > 0),
                              hist_rows=hist_rows, summ=summ, prep=prep,
                              y10=cells.targets10(frame, n_cell))
        records.append(rec)
        fill_info.append(grade_fill)
        if np.isfinite(prep["hr0"]):
            start_hrs.append(float(prep["hr0"]))
    ordered = sorted(zip(records, fill_info), key=lambda item: (item[0].start, item[0].session_id))
    records = [rec for rec, _info in ordered]
    fill_info = [info for _rec, info in ordered]
    if not records:
        raise ApiError(422, "INPUT_INSUFFICIENT", "개인화에 쓸 수 있는 support 러닝이 없습니다.",
                       [{"name": "sessions", "reason": "2분 이상이고 출발 HR·속도 입력이 필요합니다"}])
    return records, start_hrs, package, fill_info


def compute_personalization(body, runtime, *, now: datetime | None = None, previous: dict | None = None) -> dict:
    records, start_hrs, package, fill_info = _records(body, runtime)
    model_user_key = str(body.user_id)
    user_seed = int(hashlib.sha256(model_user_key.encode()).hexdigest()[:8], 16)
    context_module = __import__(package.__name__ + ".context", fromlist=["SourceIndex", "build_context"])
    contexts = context_module.contexts_for(records, records)
    latest = max(r.end_hist for r in records) + timedelta(seconds=1)
    target = SimpleNamespace(group=model_user_key, start=latest, start_s=latest.timestamp())
    current = context_module.build_context(target, context_module.SourceIndex(records))

    fit_items = runtime.fit_module.fit_items(records, contexts, seed=user_seed)
    p4 = np.zeros(4, np.float32)
    warnings = []
    previous_p4 = previous.get("p4") if isinstance(previous, dict) else None
    valid_previous = (
        isinstance(previous, dict) and previous.get("modelVersion") == runtime.info.model_version
        and isinstance(previous_p4, list) and len(previous_p4) == 4
        and all(isinstance(value, (int, float)) and not isinstance(value, bool)
                and abs(value) <= 10 and np.isfinite(value) for value in previous_p4)
    )
    warm = valid_previous and os.getenv("ODEV21_P4_WARM_START", "1").strip().lower() in {"1", "true", "yes", "on"}
    if previous is not None and not valid_previous:
        warnings.append("P4_WARM_START_SKIPPED")
    if fit_items:
        lr = float(os.getenv("ODEV21_P4_LR", "0.03"))
        lam = float(os.getenv("ODEV21_P4_LAMBDA", "1.0"))
        steps = max(1, int(os.getenv("ODEV21_P4_WARM_STEPS", "20") if warm
                           else os.getenv("ODEV21_P4_STEPS", "100")))
        fit_options = {}
        if warm:
            fit_options = {"init": {model_user_key: previous_p4},
                           "early_stop_tol": float(os.getenv("ODEV21_P4_EARLY_STOP_TOL", "0"))}
        snapshots = runtime.fit_module.fit_p4(runtime.model, {model_user_key: fit_items}, runtime.stats,
                                             lr=lr, lam=lam, steps=(steps,), per_step=4,
                                             seed=user_seed,
                                             device=runtime.device, **fit_options)
        p4 = np.asarray(snapshots[steps][model_user_key], np.float32)
    else:
        warnings.append("P4_INPUT_INSUFFICIENT")

    grade_filled_run_count = sum(info.filled for info in fill_info)
    grade_rows = sum(info.rows for info in fill_info)
    grade_missing_ratio = round(sum(info.missing_rows for info in fill_info) / grade_rows, 4) if grade_rows else 0.0
    if grade_filled_run_count:
        warnings.append("GRADE_FILLED_0")

    support_hr = float(np.median(start_hrs)) if start_hrs else 85.0
    raw = dict(current.u_raw)
    # Serialize the model's exact ordered summary values as a named vector.
    summary_u = {name: _json_safe(value) for name, value in raw.items() if name != "hr_hist"}
    history8 = _json_safe(current.history[-512:])
    return {
        "schemaVersion": "runway.ode.personalization.v1",
        "userId": body.user_id,
        "modelVersion": runtime.info.model_version,
        "createdAt": (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "supportRunCount": len(records),
        "gradeFilledRunCount": grade_filled_run_count,
        "gradeMissingRatio": grade_missing_ratio,
        "summaryU": summary_u,
        "hrRefBpm": _json_safe(raw.get("hr_ref")),
        "history8": history8,
        "p4": _json_safe(p4),
        "hr0SubBpm": round(support_hr, 2),
        "warnings": warnings,
    }
