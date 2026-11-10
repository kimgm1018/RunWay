"""기본 GRU 배치 예측과 AI04 정책 기준으로 전원이 달릴 공동 페이스를 고른다."""
import os

import numpy as np

from app.decide.service import _thresholds_for_user, recent_inputs
from app.group_pace.schemas import GroupPaceRequest, GroupPaceResponse
from app.inference import ApiError, check_sufficient, to_batch
from app.pace_selector import DELTAS, PaceSelector, candidate_paces, upper_bound
from app.policy.mpc_policy import _mean, allow_at
from app.schemas import Candidate, PredictRequest

MAX_BATCH_WINDOWS = 256


def group_pace_enabled() -> bool:
    return os.getenv("GROUP_PACE_ENABLED", "false").strip().lower() in {"true", "1", "yes", "on"}


def _merge_batches(parts: list[dict]) -> dict:
    """길이가 다른 history는 왼쪽을 빈칸으로 채워 마지막 칸(t0)을 맞춘다."""
    width = max(part["hr"].shape[1] for part in parts)
    merged = {}
    for key in parts[0]:
        if key == "session_start_s":
            merged[key] = None
            continue
        arrays = []
        for part in parts:
            values = part[key]
            if key in {"hr", "speed", "grade", "segment"}:
                if key == "segment" and values is None:
                    values = np.zeros(part["hr"].shape, dtype=np.int64)
                fill = -1 if key == "segment" else np.nan
                values = np.pad(values, ((0, 0), (width - values.shape[1], 0)), constant_values=fill)
            arrays.append(values)
        merged[key] = np.concatenate(arrays, axis=0)
    return merged


def _predict_all(model, requests: list[PredictRequest], candidate_count: int) -> np.ndarray:
    """작은 그룹은 한 번, 큰 그룹은 최대 256개 창씩 기본 GRU로 예측한다."""
    predictions = []
    parts = []
    size = 0

    def flush():
        batch = _merge_batches(parts)
        try:
            output = np.asarray(model.predict(batch), dtype=float)
        except Exception:
            raise ApiError(500, "PREDICTION_FAILED", "모델 출력이 올바르지 않습니다.") from None
        if output.shape != (size, 3) or not np.isfinite(output).all():
            raise ApiError(500, "PREDICTION_FAILED", "모델 출력이 올바르지 않습니다.")
        predictions.append(output)

    for request in requests:
        batch = to_batch(request, "flat0")
        for start in range(0, candidate_count):
            parts.append({key: None if value is None else value[start:start + 1] for key, value in batch.items()})
            size += 1
            if size == MAX_BATCH_WINDOWS:
                flush()
                parts, size = [], 0
    if parts:
        flush()
    return np.concatenate(predictions).reshape(len(requests), candidate_count, 3)


def recommend_group_pace(body: GroupPaceRequest, model, policy, *, hr_threshold_lookup=None,
                         hr_threshold_lookup_configured: bool = True) -> GroupPaceResponse:
    current = body.current_group_pace_sec_per_km
    paces = candidate_paces(current, DELTAS)
    baseline = paces.index(current)
    cfg, margins = policy.cfg, policy.margins
    excluded = 0
    pace_only = 0
    references = []
    hr_members = []
    requests = []
    warnings = []

    for member in body.participants:
        if not member.active:
            excluded += 1
            continue
        _, _, reference_pace = recent_inputs(member.history)
        if member.user_id is None or all(hr is None for hr in member.history.hr_bpm):
            pace_only += 1
            if reference_pace is None:
                excluded += 1
                warnings.append("PARTICIPANT_DATA_UNUSABLE")
            else:
                references.append(reference_pace)
            continue
        # 미래 경사 모름은 추론에서만 평지로 채운다. 상한 계산에는 원래의 모름 상태를 유지한다.
        grade_known = member.future_grade_pct is not None and all(g is not None for g in member.future_grade_pct)
        candidates = [Candidate(future_speed_mps=[1000.0 / pace] * 24,
                                future_grade_pct=member.future_grade_pct if grade_known else [0.0] * 24)
                      for pace in paces]
        request = PredictRequest(elapsed_sec=body.elapsed_sec, history=member.history, candidates=candidates)
        try:
            check_sufficient(request, model.info.min_samples, "flat0")
        except ApiError:
            excluded += 1
            warnings.append("PARTICIPANT_DATA_UNUSABLE")
            continue
        ref, threshold_warnings = _thresholds_for_user(
            member.user_id, hr_threshold_lookup, cfg, configured=hr_threshold_lookup_configured)
        warnings.extend(threshold_warnings)
        # 백엔드가 계산한 그룹 진행률을 사용하며, 없으면 출발 시점 기준으로 판단한다.
        allow = allow_at(body.progress_ratio or 0.0, ref, cfg)
        mean_grade = sum(member.future_grade_pct) / 24 if grade_known else None
        if not grade_known:
            warnings.append("GRADE_UNKNOWN")
        requests.append(request)
        # AI04 여유 표 방향은 최근 6칸이 전부 있을 때만 평균 속도로 분류한다.
        past_speeds = member.history.speed_mps[-6:]
        mean_past = _mean(tuple(past_speeds)) if len(past_speeds) == 6 else None
        hr_members.append((ref, allow, mean_past, mean_grade))

    def response(index, reason):
        pace = paces[index]
        changed = abs(pace - current) >= 10
        if not changed:
            index, pace = baseline, current
        return GroupPaceResponse(
            group_pace_sec_per_km=pace, changed=changed,
            direction=("SLOW" if pace > current else "FAST") if changed else "HOLD", reason=reason,
            struggling_count=int(np.sum(uppers[:, index] >= allows)) if hr_members else 0,
            excluded_count=excluded, pace_only_count=pace_only,
            warnings=list(dict.fromkeys(warnings)), model_version=model.info.model_version)

    if not requests and not references:
        return response(baseline, "NO_DATA")

    uppers = np.empty((len(requests), len(paces)))
    allows = np.asarray([member[1] for member in hr_members])
    danger = False
    if requests:
        predictions = _predict_all(model, requests, len(paces))
        for i, (ref, allow, measured_speed, mean_grade) in enumerate(hr_members):
            danger |= predictions[i, baseline, 2] >= ref.danger_bpm
            for j, pace in enumerate(paces):
                uppers[i, j] = upper_bound(predictions[i, j], pace, current, measured_speed, mean_grade, cfg, margins)

    def blocked(index):
        # 미동의자의 실측보다 30초/km 초과 빠른 후보만 막으며, 감속은 절대 막지 않는다.
        pace = paces[index]
        return pace <= current and any(pace < reference - 30 for reference in references)

    cap = body.goal_pace_sec_per_km
    if cap is None:
        cap = body.start_recommended_pace_sec_per_km
    since_change = ((body.now - body.last_change.changed_at).total_seconds()
                    if body.last_change is not None else None)
    selection = PaceSelector(paces, current, uppers, allows, blocked).select(
        danger=bool(danger), cap=cap, elapsed_sec=body.elapsed_sec, since_change_sec=since_change)
    if selection.cap_missing:
        warnings.append("RECOVERY_CAP_MISSING")
    return response(selection.index, selection.reason)
