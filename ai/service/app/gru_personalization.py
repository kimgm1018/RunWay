"""러닝 중 GRU 개인화 출력층을 계산하고 읽는다."""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from contextlib import nullcontext
from dataclasses import dataclass
import json
import logging
import math
import os
import threading
import time

import numpy as np
import pandas as pd

from app.db_lookup import (DatabaseUnavailable, GRU_PERSONALIZATION_COLUMNS, GRU_PERSONALIZATION_SQL,
                           GRU_PERSONALIZATION_TABLE, MISSING_RELATION_SQLSTATES)
from app.ai_logging import log_ai_error
from app.inference import ApiError

GRU_PERSONALIZATION_SCHEMA_VERSION = "runway.gru.head.v1"
GOOD_QUALITY = frozenset({"GOOD", "LOW"})
USABLE_WORKOUT_QUALITY = frozenset({"CLEAN", "USABLE_WITH_FLAGS"})
MISSING_WARNING = "GRU_PERSONALIZATION_TABLE_MISSING"
NOT_FOUND_WARNING = "GRU_PERSONALIZATION_NOT_FOUND"
MODEL_MISMATCH_WARNING = "GRU_PERSONALIZATION_MODEL_MISMATCH"
INVALID_WARNING = "GRU_PERSONALIZATION_INVALID"
UNAVAILABLE_WARNING = "GRU_PERSONALIZATION_UNAVAILABLE"
NO_WINDOWS_WARNING = "GRU_PERSONALIZATION_NO_SUPPORT_WINDOWS"


@dataclass(frozen=True)
class GruPersonalizationResult:
    state: dict | None = None
    personalization_version: int | None = None
    warning: str | None = None


def _sample_value(value, quality):
    """ODE와 같이 GOOD·LOW만 유효 입력으로 보고 MISSING은 비운다."""
    if value is None or quality not in GOOD_QUALITY:
        return np.nan
    return float(value)


def support_to_frames(body) -> list[pd.DataFrame]:
    """AI06 샘플을 GRU predictor가 받는 canonical DataFrame 목록으로 바꾼다."""
    frames = []
    sessions = sorted(body.sessions, key=lambda session: session.session_started_at, reverse=True)
    for session in sessions:
        if session.workout_quality not in USABLE_WORKOUT_QUALITY:
            continue
        frame = pd.DataFrame([{
            "session_id": session.session_id,
            "segment_id": 0,
            "elapsed_s": sample.elapsed_sec,
            "hr_bpm": _sample_value(sample.hr_bpm, sample.hr_quality),
            "speed_mps": _sample_value(sample.speed_mps, sample.speed_quality),
            "grade_observed_pct": _sample_value(sample.grade_percent, sample.grade_quality),
            # ODE는 GOOD·LOW를 채점에 쓰지만 GRU 학습 자료는 GOOD만 채점한다.
            # 같은 측정 허용 규칙을 적용하도록 입력 경계에서 LOW를 GOOD으로 맞춘다.
            "hr_quality": "GOOD" if sample.hr_quality in GOOD_QUALITY else "MISSING",
            "hr_is_filled": bool(sample.hr_is_filled),
        } for sample in session.samples], columns=(
            "session_id", "segment_id", "elapsed_s", "hr_bpm", "speed_mps",
            "grade_observed_pct", "hr_quality", "hr_is_filled",
        ))
        frame = frame.sort_values(["segment_id", "elapsed_s"], kind="stable").reset_index(drop=True)
        elapsed = frame.elapsed_s.to_numpy(np.float64)
        if frame.empty or frame.elapsed_s.duplicated().any() or not np.isclose(elapsed[0], 0.0):
            raise ApiError(400, "VALIDATION_ERROR", "support sample은 0초부터 중복 없이 이어져야 합니다.",
                           [{"name": "sessions.samples.elapsedSec", "reason": "0초 시작과 중복 없는 5초 간격이 필요합니다."}])
        intervals = np.diff(elapsed)
        if len(intervals) and not np.allclose(intervals, 5.0):
            raise ApiError(400, "VALIDATION_ERROR", "support sample 간격은 5초여야 합니다.",
                           [{"name": "sessions.samples.elapsedSec", "reason": "5초 간격이 아닙니다."}])
        frames.append(frame)
    return frames


def _feature_window_count(features) -> int:
    if features is None:
        return 0
    mask = features[2]
    if hasattr(mask, "detach"):
        mask = mask.detach().cpu().numpy()
    mask = np.asarray(mask)
    if mask.ndim == 1:
        return int(np.count_nonzero(mask))
    if mask.ndim == 2:
        return int(np.count_nonzero(np.any(mask > 0, axis=1)))
    return 0


def _limit_feature_windows(features, limit: int):
    if features is None or not features or limit <= 0:
        return None, 0
    rows = int(features[0].shape[0])
    selected = min(rows, limit)
    if selected <= 0:
        return None, 0
    return tuple(value[:selected] for value in features), selected


def _join_feature_batches(batches):
    if not batches:
        return None
    import torch
    return tuple(torch.cat([batch[index] for batch in batches], dim=0) for index in range(3))


def _max_training_windows(value: int | None = None) -> int:
    if value is not None:
        return max(1, int(value))
    try:
        return max(1, int(os.getenv("GRU_PERSONALIZATION_MAX_WINDOWS", "2000")))
    except (TypeError, ValueError):
        return 2000


def _head_json(state: dict, base: dict) -> dict:
    """출력층 모양은 지금 로드한 GRU의 기본 출력층과 같아야 한다(M3-005: [3,256]/[3])."""
    head = {}
    for key in ("main", "nograde"):
        weight, bias = state[key]
        if hasattr(weight, "detach"):
            weight = weight.detach().cpu().numpy()
        if hasattr(bias, "detach"):
            bias = bias.detach().cpu().numpy()
        weight = np.asarray(weight, dtype=np.float64)
        bias = np.asarray(bias, dtype=np.float64)
        base_weight, base_bias = base[key]
        if weight.shape != tuple(base_weight.shape) or bias.shape != tuple(base_bias.shape):
            raise ValueError("GRU 출력층 모양이 로드한 모델과 다릅니다.")
        if not np.isfinite(weight).all() or not np.isfinite(bias).all():
            raise ValueError("GRU 출력층에 유한하지 않은 값이 있습니다.")
        head[key] = {"weight": weight.tolist(), "bias": bias.tolist()}
    return head


def compute_gru_personalization(body, model, *, max_windows: int | None = None) -> tuple[dict | None, list[str]]:
    """기본 predictor 상태를 바꾸지 않고 Support로 두 출력층만 계산한다."""
    predictor = getattr(model, "predictor", None)
    if predictor is None or not {"main", "nograde"}.issubset(getattr(predictor, "models", {})):
        log_ai_error(UNAVAILABLE_WARNING, "/v1/hr/personalize", Warning(),
                     level=logging.WARNING)
        return None, [UNAVAILABLE_WARNING]
    sha256 = getattr(model, "sha256", None)
    if not isinstance(sha256, str) or len(sha256) != 64:
        log_ai_error(UNAVAILABLE_WARNING, "/v1/hr/personalize", Warning(),
                     level=logging.WARNING)
        return None, [UNAVAILABLE_WARNING]

    support = support_to_frames(body)
    window_limit = _max_training_windows(max_windows)
    try:
        # features는 GRU 본체만 읽고 fit_head는 복제본만 학습한다. 예측도 공유 상태를 바꾸지 않는다.
        with nullcontext() if getattr(model, "_mutation_free", False) else model.lock:
            batches = {key: [] for key in predictor.models}
            used_runs = 0
            for frame in support:
                if all(sum(batch[0].shape[0] for batch in batches[key]) >= window_limit
                       for key in predictor.models):
                    break
                run_used = False
                for key in predictor.models:
                    used = sum(batch[0].shape[0] for batch in batches[key])
                    remaining = window_limit - used
                    if remaining <= 0:
                        continue
                    features = predictor.support_features([frame], key)
                    selected, selected_count = _limit_feature_windows(features, remaining)
                    if selected is not None:
                        batches[key].append(selected)
                        run_used = True
                if run_used:
                    used_runs += 1
            features = {key: _join_feature_batches(value) for key, value in batches.items()}
            window_count = _feature_window_count(features.get("main"))
            if window_count == 0 or not any(_feature_window_count(value) for value in features.values()):
                log_ai_error(NO_WINDOWS_WARNING, "/v1/hr/personalize", Warning(),
                             level=logging.WARNING)
                return None, [NO_WINDOWS_WARNING]
            state = {
                key: predictor.fit_head(predictor.base[key], features[key], 100, 1e-3, 0.03)
                for key in predictor.models
            }
            head = _head_json(state, predictor.base)
    except ApiError:
        raise
    except Exception as exc:
        log_ai_error("GRU_PERSONALIZATION_UNAVAILABLE", "/v1/hr/personalize", exc,
                     level=logging.WARNING)
        return None, [UNAVAILABLE_WARNING]

    return {
        "schemaVersion": GRU_PERSONALIZATION_SCHEMA_VERSION,
        "modelVersion": model.info.model_version,
        "modelSha256": sha256,
        "supportRunCount": used_runs,
        "supportWindowCount": window_count,
        "head": head,
    }, []


def _sqlstate(exc: BaseException) -> str | None:
    value = getattr(exc, "sqlstate", None)
    return value if isinstance(value, str) and len(value) == 5 and value.isalnum() else None


class DbGruPersonalizationLookup:
    """GRU 개인화 행을 읽는 어댑터. DB 연결과 SQL 원문은 응답에 내보내지 않는다."""

    def __init__(self, db, *, timeout_ms: int = 300):
        self.db = db
        self.timeout_ms = max(1, int(timeout_ms))

    def get_latest(self, user_id: int) -> tuple[dict | None, str | None, bool]:
        try:
            fetch_with_timeout = getattr(self.db, "fetch_one_with_timeout", None)
            if callable(fetch_with_timeout):
                row = fetch_with_timeout(GRU_PERSONALIZATION_SQL, {"user_id": int(user_id)}, self.timeout_ms)
            else:
                row = self.db.fetch_one(GRU_PERSONALIZATION_SQL, {"user_id": int(user_id)})
        except DatabaseUnavailable as exc:
            if exc.sqlstate in MISSING_RELATION_SQLSTATES:
                return None, MISSING_WARNING, True
            return None, UNAVAILABLE_WARNING, False
        except Exception as exc:
            if _sqlstate(exc) in MISSING_RELATION_SQLSTATES:
                return None, MISSING_WARNING, True
            log_ai_error("GRU_PERSONALIZATION_UNAVAILABLE", "personalization_lookup", exc,
                         level=logging.WARNING)
            return None, UNAVAILABLE_WARNING, False
        if row is None:
            return None, NOT_FOUND_WARNING, True
        return dict(row), None, True


class CachedDbGruPersonalizationLookup:
    """사용자별 GRU 출력층 조회 캐시. 찾지 못한 행은 짧게 보관한다."""

    def __init__(self, db, *, ttl_sec: float = 300, empty_ttl_sec: float = 60,
                 max_users: int = 1024, timeout_ms: int = 300, monotonic=time.monotonic):
        self.adapter = DbGruPersonalizationLookup(db, timeout_ms=timeout_ms)
        self.ttl_sec = max(0.0, float(ttl_sec))
        self.empty_ttl_sec = max(0.0, float(empty_ttl_sec))
        self.max_users = max(0, int(max_users))
        self.monotonic = monotonic
        self._cache: OrderedDict[int, tuple[float, dict | None, str | None]] = OrderedDict()
        self._lock = threading.RLock()
        self._inflight: dict[int, Future] = {}

    @staticmethod
    def _decode_head(value):
        if isinstance(value, (str, bytes)):
            try:
                return json.loads(value)
            except (TypeError, ValueError):
                return None
        return value

    @staticmethod
    def _number(value) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        number = float(value)
        return number if math.isfinite(number) else None

    def _state(self, head, model) -> dict | None:
        if not isinstance(head, dict) or set(head) != {"main", "nograde"}:
            return None
        predictor = getattr(model, "predictor", None)
        if predictor is None:
            return None
        state = {}
        try:
            import torch
            for key in ("main", "nograde"):
                item = head[key]
                if not isinstance(item, dict) or set(item) != {"weight", "bias"}:
                    return None
                weight, bias = item["weight"], item["bias"]
                base_weight, base_bias = predictor.base[key]
                n_out, n_hidden = tuple(base_weight.shape)
                if (not isinstance(weight, list) or len(weight) != n_out or not isinstance(bias, list)
                        or len(bias) != n_out):
                    return None
                rows = []
                for row in weight:
                    if not isinstance(row, list) or len(row) != n_hidden:
                        return None
                    converted = [self._number(value) for value in row]
                    if any(value is None for value in converted):
                        return None
                    rows.append(converted)
                converted_bias = [self._number(value) for value in bias]
                if any(value is None for value in converted_bias):
                    return None
                state[key] = (
                    torch.tensor(rows, dtype=base_weight.dtype, device=base_weight.device),
                    torch.tensor(converted_bias, dtype=base_bias.dtype, device=base_bias.device),
                )
        except Exception:
            return None
        return state

    def get_for_model(self, user_id: int, model) -> GruPersonalizationResult:
        sha256 = getattr(model, "sha256", None)
        if not isinstance(sha256, str) or len(sha256) != 64 or getattr(model, "predictor", None) is None:
            return GruPersonalizationResult(warning=UNAVAILABLE_WARNING)

        now = self.monotonic()
        user_id = int(user_id)
        flight = None
        leader = False
        with self._lock:
            cached = self._cache.get(user_id)
            if cached is not None and cached[0] > now:
                self._cache.move_to_end(user_id)
                row, warning = cached[1], cached[2]
            else:
                self._cache.pop(user_id, None)
                flight = self._inflight.get(user_id)
                if flight is None:
                    flight = Future()
                    self._inflight[user_id] = flight
                    leader = True

        if leader:
            try:
                # DB 대기 중에는 다른 사용자의 캐시와 조회를 막지 않는다.
                row, warning, cacheable = self.adapter.get_latest(user_id)
                with self._lock:
                    if cacheable and self.max_users > 0:
                        ttl = self.empty_ttl_sec if row is None else self.ttl_sec
                        if ttl > 0:
                            self._cache[user_id] = (now + ttl, row, warning)
                            self._cache.move_to_end(user_id)
                            while len(self._cache) > self.max_users:
                                self._cache.popitem(last=False)
            except BaseException as exc:
                with self._lock:
                    flight.set_exception(exc)
                raise
            else:
                with self._lock:
                    flight.set_result((row, warning))
            finally:
                with self._lock:
                    self._inflight.pop(user_id, None)
        elif flight is not None:
            row, warning = flight.result()

        if warning is not None:
            return GruPersonalizationResult(warning=warning)
        if row is None:
            return GruPersonalizationResult(warning=NOT_FOUND_WARNING)
        if (row.get("schema_version") != GRU_PERSONALIZATION_SCHEMA_VERSION
                or row.get("model_sha256") != sha256):
            return GruPersonalizationResult(warning=MODEL_MISMATCH_WARNING)
        version = row.get("personalization_version")
        if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
            return GruPersonalizationResult(warning=INVALID_WARNING)
        state = self._state(self._decode_head(row.get("head_json")), model)
        if state is None:
            return GruPersonalizationResult(warning=INVALID_WARNING)
        return GruPersonalizationResult(state=state, personalization_version=version)


def lookup_user_personalization(
    lookup, user_id: int, model, *, endpoint: str = "personalization_lookup",
) -> GruPersonalizationResult:
    """어댑터 오류도 러닝 예측 중단 없이 경고 결과로 바꾼다."""
    if lookup is None:
        log_ai_error(UNAVAILABLE_WARNING, endpoint, Warning(), level=logging.WARNING)
        return GruPersonalizationResult(warning=UNAVAILABLE_WARNING)
    try:
        result = lookup.get_for_model(user_id, model)
        result = result if isinstance(result, GruPersonalizationResult) else GruPersonalizationResult(warning=INVALID_WARNING)
        if result.warning:
            log_ai_error(result.warning, endpoint, Warning(), level=logging.WARNING)
        return result
    except Exception as exc:
        log_ai_error("GRU_PERSONALIZATION_UNAVAILABLE", "personalization_lookup", exc,
                     level=logging.WARNING)
        return GruPersonalizationResult(warning=UNAVAILABLE_WARNING)


__all__ = [
    "CachedDbGruPersonalizationLookup", "DbGruPersonalizationLookup", "GRU_PERSONALIZATION_COLUMNS",
    "GRU_PERSONALIZATION_SCHEMA_VERSION", "GRU_PERSONALIZATION_SQL", "GRU_PERSONALIZATION_TABLE",
    "GruPersonalizationResult", "compute_gru_personalization", "lookup_user_personalization",
    "support_to_frames",
]
