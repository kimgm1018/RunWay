"""기본 GRU 배치 예측과 AI04 정책 기준으로 전원이 달릴 공동 페이스를 고른다."""
import os

import numpy as np

from app.decide.service import _apply_readiness, _user_hr_lookup_full, recent_inputs
from app.gru_gb import apply_gb, is_identity, personal_weight
from app.group_pace.ahead import REASON as AHEAD_REASON, AheadSettings, try_ahead
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


def _fill_detail(detail: dict, *, paces, baseline, chosen, requests, hr_members, uppers, predictions) -> None:
    """시연 기록에 쓸 계산값만 옮긴다. 응답·선택에는 영향이 없다."""
    detail.update({
        "paces": [float(p) for p in paces], "baseline": baseline, "chosen": chosen,
        "members": [{"history": request.history, "allow": float(member[1]), "danger": float(member[0].danger_bpm),
                     "upper": [float(v) for v in uppers[i]] if uppers is not None else None,
                     "pred": [[float(v) for v in row] for row in predictions[i]] if predictions is not None else None}
                    for i, (request, member) in enumerate(zip(requests, hr_members))],
    })


def recommend_group_pace(body: GroupPaceRequest, model, policy, *, hr_threshold_lookup=None,
                         hr_threshold_lookup_configured: bool = True, detail: dict | None = None,
                         gru_gb_enabled: bool = False, readiness_lookup=None, ahead: AheadSettings | None = None,
                         ahead_wait_sec: float | None = None, ahead_demo_wait: bool = False) -> GroupPaceResponse:
    """detail에 dict를 넘기면(시연 기록용) 후보·멤버별 계산값을 채운다. None이면 아무것도 하지 않는다.

    gru_gb_enabled=True면 회원마다 자기 개인 g·b를 기본 GRU 출력에 적용한다(S15P31E105-641, 기본 꺼짐).
    readiness_lookup(S15P31E105-676, 기본 None=꺼짐): 회원마다 자기 오늘 준비도·민감도로 자기 허용선만 낮춘다.
    ahead(S15P31E105-728, 기본 None=꺼짐): 여유 가속 설정. 기존 선택이 페이스를 바꾸지 않을 때만 출발 페이스보다 빠르게
    올리는지 본다(app.group_pace.ahead). ahead_wait_sec는 출발 뒤 대기 시간(시연 계정 그룹은 짧게).
    """
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
    member_gb = []
    member_readiness = []

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
        ref, threshold_warnings, gb, row = _user_hr_lookup_full(
            member.user_id, hr_threshold_lookup, cfg, configured=hr_threshold_lookup_configured)
        warnings.extend(threshold_warnings)
        ref, readiness, readiness_warnings = _apply_readiness(member.user_id, ref, row, readiness_lookup, body.now)
        warnings.extend(readiness_warnings)
        # 백엔드가 계산한 그룹 진행률을 사용하며, 없으면 출발 시점 기준으로 판단한다.
        allow = allow_at(body.progress_ratio or 0.0, ref, cfg)
        mean_grade = sum(member.future_grade_pct) / 24 if grade_known else None
        if not grade_known:
            warnings.append("GRADE_UNKNOWN")
        requests.append(request)
        member_gb.append(gb)
        member_readiness.append(readiness)
        # AI04 여유 표 방향은 최근 6칸이 전부 있을 때만 평균 속도로 분류한다.
        past_speeds = member.history.speed_mps[-6:]
        mean_past = _mean(tuple(past_speeds)) if len(past_speeds) == 6 else None
        hr_members.append((ref, allow, mean_past, mean_grade))

    def response(index, reason):
        pace = paces[index]
        changed = abs(pace - current) >= 10
        if not changed:
            index, pace = baseline, current
        if detail is not None:
            _fill_detail(detail, paces=paces, baseline=baseline, chosen=index, requests=requests, hr_members=hr_members,
                         uppers=uppers if hr_members else None,
                         predictions=predictions if requests else None)
            if gru_gb_enabled:
                # 641 시연 기록: 회원별 개인 g·b 적용 여부·비중·러닝 수(꺼져 있으면 넣지 않음)
                for member, gb in zip(detail["members"], member_gb):
                    applied = not is_identity(gb[0], gb[1])
                    member["gruGb"] = {"applied": applied, "supportN": gb[2],
                                       "weight": personal_weight(gb[2], gb[0], gb[1])}
            if readiness_lookup is not None:
                # 676 시연 기록: 회원별 오늘 준비도·허용 심박 감소·개인 c 비중(꺼져 있으면 넣지 않음)
                for member, adjust in zip(detail["members"], member_readiness):
                    member["readiness"] = {"score": adjust.score, "adjustBpm": round(adjust.drop_bpm, 3),
                                           "weight": round(adjust.weight, 4)} if adjust is not None else None
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
        if gru_gb_enabled:
            for i, (request, gb) in enumerate(zip(requests, member_gb)):
                if not is_identity(gb[0], gb[1]):
                    predictions[i] = apply_gb(predictions[i], request.history.hr_bpm[-1], gb[0], gb[1])
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
    if body.pace_mode == "GOAL" and body.goal_pace_sec_per_km is not None:
        # 목표 페이스 모드(S15P31E105-680): 허용·주의선 대신 위험 심박만 본다. 판정선은 회원별 위험 심박, 상한은 여유 없는 예측이다.
        # 지금·느린 후보는 기존 위험 조건과 같은 120초 예측을 쓴다(30·60초 예측은 늦춰도 거의 그대로라 쓰면 매번 FLOOR로
        # 연속 감속한다, 리뷰 B-1). 빠른(회복) 후보만 세 지평선 최대로 보수적으로 본다. 회복은 목표까지만 한다.
        if requests:
            raw = predictions[:, :, 2].copy()
            raw[:, :baseline] = predictions[:, :baseline, :].max(axis=2)
        else:
            raw = np.empty((0, len(paces)))
        dangers = np.asarray([member[0].danger_bpm for member in hr_members])
        goal_danger = bool(np.any(raw[:, baseline] >= dangers)) if requests else False
        selection = PaceSelector(paces, current, raw, dangers, blocked).select(
            danger=goal_danger, cap=body.goal_pace_sec_per_km, elapsed_sec=body.elapsed_sec,
            since_change_sec=since_change, warmup_exempt=goal_danger)
    else:
        selection = PaceSelector(paces, current, uppers, allows, blocked).select(
            danger=bool(danger), cap=cap, elapsed_sec=body.elapsed_sec, since_change_sec=since_change)
    if selection.cap_missing:
        warnings.append("RECOVERY_CAP_MISSING")
    if ahead is not None and selection.index == paces.index(current):
        target = try_ahead(
            settings=ahead, wait_sec=ahead.wait_sec if ahead_wait_sec is None else ahead_wait_sec,
            demo_wait=ahead_demo_wait, mode=body.pace_mode, paces=paces, current=current,
            start_pace=body.start_recommended_pace_sec_per_km, elapsed_sec=body.elapsed_sec,
            since_change_sec=since_change, danger=bool(danger), excluded=excluded, pace_only=pace_only,
            uppers=uppers, allows=allows, histories=[r.history.hr_bpm for r in requests], detail=detail)
        if target is not None:
            return response(target, AHEAD_REASON)
    elif ahead is not None and detail is not None:
        # 기존 규칙(감속·회복)이 이미 바꿨으면 여유 가속은 보지 않는다.
        detail["ahead"] = {"applied": False, "blockedBy": "OTHER_CHANGE", "waitSec": ahead_wait_sec,
                           "demoWait": ahead_demo_wait, "marginBpm": ahead.margin_bpm,
                           "steadySec": ahead.streak * 30, "startPace": body.start_recommended_pace_sec_per_km,
                           "fastestPace": None}
    return response(selection.index, selection.reason)
