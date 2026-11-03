"""추론 서버의 오류 형식과 공통 모델 입력 변환."""
import os

import numpy as np

from app.models.base import FUTURE_STEPS
from app.schemas import PredictRequest

# 자유러닝(history 경사가 전부 null) 처리. 기본값 flat0은 사용자 확정(2026-11-02)이며 팀 기존 계약(reject)과 다르다.
#   reject  : 팀 기존 계약. 경사가 있는 칸이 부족하면 422 INPUT_INSUFFICIENT
#   unknown : 과거 경사는 0%로 채우고(GRU가 과거 경사를 항상 읽음), 미래 경사 null은 그대로 둬 경사 없는 모델로 예측
#   flat0   : 과거·미래 경사를 모두 0% 평지로 채워 미래 경사를 읽는 모델로 예측(기본값)
FREE_RUN_GRADE_POLICIES = ("reject", "unknown", "flat0")
DEFAULT_FREE_RUN_GRADE_POLICY = "flat0"


def load_free_run_grade_policy() -> str:
    value = os.getenv("FREE_RUN_GRADE_POLICY", DEFAULT_FREE_RUN_GRADE_POLICY).strip().lower()
    if value not in FREE_RUN_GRADE_POLICIES:
        raise ValueError(f"FREE_RUN_GRADE_POLICY는 {'|'.join(FREE_RUN_GRADE_POLICIES)} 중 하나여야 합니다: {value}")
    return value


def is_free_run(body: PredictRequest, policy: str) -> bool:
    return policy != "reject" and all(value is None for value in body.history.grade_pct)


def free_run_warnings(body: PredictRequest, policy: str) -> list[str]:
    if not is_free_run(body, policy):
        return []
    return [f"FREE_RUN_GRADE_POLICY_{policy.upper()}_PROVISIONAL", "FREE_RUN_HISTORY_GRADE_FILLED_0"]


def future_grade_used(body: PredictRequest, policy: str) -> list[bool]:
    """후보별로 미래 경사를 읽는 모델을 썼는지. flat0 자유러닝은 0%로 채워 읽는다."""
    filled = is_free_run(body, policy) and policy == "flat0"
    return [candidate.grade_known or filled for candidate in body.candidates]


class ApiError(Exception):
    """클라이언트에 안전한 API 오류."""
    def __init__(self, status: int, code: str, message: str, fields: list[dict] | None = None,
                 headers: dict[str, str] | None = None):
        self.status, self.code, self.message, self.fields, self.headers = status, code, message, fields, headers


def error_body(code: str, message: str, fields: list[dict] | None = None) -> dict:
    return {"code": code, "message": message,
            "details": {"fields": fields} if fields else None}


def check_sufficient(body: PredictRequest, min_samples: int, free_run_policy: str = "reject") -> None:
    """실측값만 사용하며 t0 HR과 충분한 완전 history 칸을 요구한다. 자유러닝은 경사를 세지 않는다."""
    history = body.history
    if history.hr_bpm[-1] is None:
        raise ApiError(422, "INPUT_INSUFFICIENT", "t0 심박이 없습니다.",
                       [{"name": "history.hrBpm", "reason": "마지막 칸(t0) 심박이 필요합니다"}])
    segment = history.segment_id
    free_run = is_free_run(body, free_run_policy)
    complete = sum(1 for i, (hr, speed, grade) in enumerate(zip(history.hr_bpm, history.speed_mps, history.grade_pct))
                   if None not in (hr, speed) and (free_run or grade is not None)
                   and (segment is None or segment[i] == segment[-1]))
    if complete < min_samples:
        raise ApiError(422, "INPUT_INSUFFICIENT", "심박·속도·경사가 모두 있는 칸이 부족합니다.",
                       [{"name": "history", "reason": f"t0와 같은 구간에 {min_samples}칸 이상 필요합니다 (현재 {complete}칸)"}])


def to_batch(body: PredictRequest, free_run_policy: str = "reject") -> dict:
    """API 요청을 후보 N개 배치로 바꾼다."""
    n = len(body.candidates)
    history = body.history
    free_run = is_free_run(body, free_run_policy)

    def series(values):
        return np.tile(np.array([np.nan if value is None else value for value in values], np.float32), (n, 1))

    future_grade = np.full((n, FUTURE_STEPS), np.nan, np.float32)
    for i, candidate in enumerate(body.candidates):
        if candidate.grade_known:
            future_grade[i] = candidate.future_grade_pct
        elif free_run and free_run_policy == "flat0":
            future_grade[i] = 0.0
    grade = np.zeros((n, len(history.grade_pct)), np.float32) if free_run else series(history.grade_pct)
    start = body.session_started_at.timestamp() if body.session_started_at else None
    return {
        "hr": series(history.hr_bpm), "speed": series(history.speed_mps), "grade": grade,
        "segment": np.tile(np.array(history.segment_id), (n, 1)) if history.segment_id is not None else None,
        "elapsed_s": np.full(n, body.elapsed_sec, np.float32),
        "future_speed": np.array([candidate.future_speed_mps for candidate in body.candidates], np.float32),
        "future_grade": future_grade,
        "session_start_s": np.full(n, start) if start is not None else None,
    }
