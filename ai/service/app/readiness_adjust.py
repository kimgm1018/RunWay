"""러닝 준비도 기반 개인 컨디션 민감도 c (S15P31E105-676).

백엔드가 매일 계산하는 러닝 준비도 R(0~100, daily_readiness.readiness_score)이 낮은 날 허용 심박을 조금 낮춘다.
- 부족분 d = max(0, 70 − R). R ≥ 70이거나 그날 R이 없으면 아무것도 바꾸지 않는다.
- 허용 심박 감소 Δ = clip(c·d, 0, 6) bpm. **더 보수적으로만** 움직인다(허용선을 올리거나 빠르게 하지 않음).
- c = w·c_user + (1 − w)·c_prior, w = n/(n + k). c_prior 0.15 bpm/점(R=45면 약 −3.75 bpm), k = 10.
  k는 AI09 목표 심박 개인 비율·학습 심박 기준의 "개인 기록 10~20회면 개인 값 비중이 절반 이상" 감각에 맞춘 값이다.
  러닝 1회 = 준비도 값 1개라 g·b(창 수천 개, k=50)보다 자료가 훨씬 적으므로 k를 작게 둔다(n=10이면 w=0.5).
- AI06이 g·b와 같은 창으로 c_user를 맞춰 summaryU에 readinessSensitivity·readinessSupportN으로 저장한다.
- AI04·AI10은 회원별 위험·지속 기준을 Δ만큼 내려 허용선(allow_at)을 Δ 낮춘다. AI09는 목표 비율을 Δ/hr_ref(최대 2%) 낮춘다.
- READINESS_ADJUST_ENABLED가 꺼져 있으면(코드 기본) 조회·계산·적용을 하지 않아 출력이 이전과 비트 단위로 같다.
- FitRec에는 준비도 자료가 없어 정확도 평가는 하지 않았다(값은 보수적 사전값에서 출발).
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import logging
import math
import os
import threading
import time

import numpy as np

from app.ai_logging import log_ai_error

SENSITIVITY_KEY = "readinessSensitivity"
SUPPORT_KEY = "readinessSupportN"
READY_SCORE = 70.0                 # R ≥ 70이면 변화 없음
C_PRIOR = 0.15                     # bpm / 준비도 1점
SHRINK_K = 10.0
C_USER_RANGE = (0.0, 0.4)
MAX_DROP_BPM = 6.0
MAX_RATIO_DROP = 0.02              # AI09 목표 비율 최대 −2%
# 백엔드 준비도 기준일(TrainingLoadService.SESSION_ZONE = Asia/Seoul)과 같은 날짜를 쓴다.
SESSION_TZ = timezone(timedelta(hours=9))
UNAVAILABLE_WARNING = "READINESS_LOOKUP_UNAVAILABLE"

READINESS_SQL = """SELECT readiness_score
FROM daily_readiness
WHERE user_id = %(user_id)s AND readiness_date = %(day)s"""
READINESS_DATES_SQL = """SELECT readiness_date, readiness_score
FROM daily_readiness
WHERE user_id = %(user_id)s AND readiness_date = ANY(%(days)s)"""


def readiness_enabled() -> bool:
    return os.getenv("READINESS_ADJUST_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def _number(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def parse_score(value) -> float | None:
    """준비도 점수. 0~100 밖이거나 숫자가 아니면 없음."""
    number = _number(value)
    return number if number is not None and 0.0 <= number <= 100.0 else None


def parse_sensitivity(value) -> float | None:
    number = _number(value)
    return number if number is not None and C_USER_RANGE[0] <= number <= C_USER_RANGE[1] else None


def parse_support_n(value) -> int:
    number = _number(value)
    return int(number) if number is not None and number >= 0 and number == int(number) else 0


def session_day(at: datetime) -> date:
    """UTC 시각 → 백엔드 준비도 기준일(서울)."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return at.astimezone(SESSION_TZ).date()


def deficit(score: float | None) -> float:
    return 0.0 if score is None else max(0.0, READY_SCORE - float(score))


def blend(c_user: float | None, n: int) -> tuple[float, float]:
    """(c, w). 개인 값이 없거나 n=0이면 사전값(w=0)."""
    if c_user is None or n <= 0:
        return C_PRIOR, 0.0
    w = n / (n + SHRINK_K)
    return w * c_user + (1.0 - w) * C_PRIOR, w


@dataclass(frozen=True)
class ReadinessAdjustment:
    score: float | None           # 그날 R(없으면 None)
    drop_bpm: float               # Δ ≥ 0
    weight: float                 # 개인 c 비중 w
    sensitivity: float            # 섞은 c


NO_ADJUSTMENT = ReadinessAdjustment(None, 0.0, 0.0, C_PRIOR)


def adjustment(score, c_user=None, n: int = 0) -> ReadinessAdjustment:
    score = parse_score(score)
    c, w = blend(parse_sensitivity(c_user), parse_support_n(n))
    drop = float(min(MAX_DROP_BPM, max(0.0, c * deficit(score))))
    return ReadinessAdjustment(score, drop, w, c)


def lower_thresholds(thresholds, drop_bpm: float):
    """AI04·AI10: 위험·지속 기준을 같은 만큼 내려 allow_at(진행률 보간)이 정확히 Δ 낮아지게 한다. Δ=0이면 같은 객체."""
    if not drop_bpm > 0.0:
        return thresholds
    return replace(thresholds, danger_bpm=thresholds.danger_bpm - drop_bpm,
                   sustain_bpm=thresholds.sustain_bpm - drop_bpm)


def ratio_drop(drop_bpm: float, hr_ref_bpm: float) -> float:
    """AI09: 목표 비율 감소량 Δ/hr_ref, 최대 2%."""
    if not drop_bpm > 0.0 or not hr_ref_bpm > 0.0:
        return 0.0
    return min(MAX_RATIO_DROP, drop_bpm / hr_ref_bpm)


# ---------------------------------------------------------------- 오늘 R 조회 (AI04·AI10·AI09)
class CachedReadinessLookup:
    """(회원, 기준일)별 R 캐시: 값 300초, 행 없음 60초, DB 조회 300 ms. 실패는 None(변화 없음)이며 캐시하지 않는다."""

    def __init__(self, db, *, ttl_sec: float = 300, empty_ttl_sec: float = 60, max_entries: int = 4096,
                 timeout_ms: int = 300, monotonic=time.monotonic):
        self.db = db
        self.ttl_sec, self.empty_ttl_sec = float(ttl_sec), float(empty_ttl_sec)
        self.max_entries, self.timeout_ms = int(max_entries), int(timeout_ms)
        self.monotonic = monotonic
        self._cache: OrderedDict[tuple[int, date], tuple[float, float | None]] = OrderedDict()
        self._lock = threading.RLock()

    def _fetch(self, sql, params):
        fetch = getattr(self.db, "fetch_one_with_timeout", None)
        return fetch(sql, params, self.timeout_ms) if callable(fetch) else self.db.fetch_one(sql, params)

    def score_for(self, user_id: int, day: date) -> tuple[float | None, str | None]:
        key, now = (int(user_id), day), self.monotonic()
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None and cached[0] > now:
                return cached[1], None
        try:
            row = self._fetch(READINESS_SQL, {"user_id": key[0], "day": day})
        except Exception as exc:
            log_ai_error(UNAVAILABLE_WARNING, "readiness", exc, level=logging.WARNING)
            return None, UNAVAILABLE_WARNING
        score = parse_score(row.get("readiness_score")) if row else None
        ttl = self.ttl_sec if score is not None else self.empty_ttl_sec
        with self._lock:
            self._cache[key] = (now + ttl, score)
            self._cache.move_to_end(key)
            while len(self._cache) > self.max_entries:
                self._cache.popitem(last=False)
        return score, None

    def scores_for_days(self, user_id: int, days) -> dict[date, float]:
        """AI06: 지난 러닝 날짜들의 R. 실패는 빈 dict."""
        days = sorted(set(days))
        if not days:
            return {}
        try:
            rows = self.db.fetch_all(READINESS_DATES_SQL, {"user_id": int(user_id), "days": days})
        except Exception as exc:
            log_ai_error(UNAVAILABLE_WARNING, "/v1/hr/personalize", exc, level=logging.WARNING)
            return {}
        out = {}
        for row in rows or []:
            day, score = row.get("readiness_date"), parse_score(row.get("readiness_score"))
            if isinstance(day, datetime):
                day = day.date()
            if isinstance(day, date) and score is not None:
                out[day] = score
        return out


def user_adjustment(lookup, user_id, at: datetime, c_user=None, n: int = 0
                    ) -> tuple[ReadinessAdjustment, tuple[str, ...]]:
    """회원 한 명의 오늘 Δ. 조회기·userId가 없거나 조회 실패면 변화 없음."""
    if lookup is None or user_id is None:
        return NO_ADJUSTMENT, ()
    try:
        score, warning = lookup.score_for(int(user_id), session_day(at))
    except Exception as exc:
        log_ai_error(UNAVAILABLE_WARNING, "readiness", exc, level=logging.WARNING)
        return NO_ADJUSTMENT, (UNAVAILABLE_WARNING,)
    return adjustment(score, c_user, n), ((warning,) if warning else ())


# ---------------------------------------------------------------- c_user 계산 (AI06)
def fit_sensitivity(residuals, deficits) -> float | None:
    """잔차 r(실측 − g·b 보정 예측, bpm)을 부족분 d에 원점 회귀: c = Σdr / Σd². d가 모두 0이면 None(정보 없음)."""
    r = np.asarray(residuals, np.float64).ravel()
    d = np.asarray(deficits, np.float64).ravel()
    sdd = float(np.dot(d, d))
    if len(r) == 0 or sdd < 1e-9:
        return None
    return float(np.clip(np.dot(d, r) / sdd, *C_USER_RANGE))


def compute_sensitivity(model, body, lookup, *, gain: float = 1.0, offset: float = 0.0) -> dict:
    """summaryU에 넣을 두 값. n = 준비도와 심박 창이 모두 있는 러닝 수."""
    from app.gru_gb import support_pairs_by_run
    from app.gru_personalization import support_to_frames

    frames = support_to_frames(body)
    started = {int(s.session_id): s.session_started_at for s in body.sessions}
    scores = lookup.scores_for_days(int(body.user_id), {session_day(at) for at in started.values()})
    runs = support_pairs_by_run(model, frames)
    residuals, deficits, n = [], [], 0
    for frame_index, x, y in runs:
        session_id = int(frames[frame_index]["session_id"].iloc[0])
        score = scores.get(session_day(started[session_id])) if session_id in started else None
        if score is None:
            continue
        residuals.append(y - (gain * x + offset))
        deficits.append(np.full(len(y), deficit(score)))
        n += 1
    c_user = fit_sensitivity(np.concatenate(residuals), np.concatenate(deficits)) if n else None
    if c_user is None:
        c_user = C_PRIOR             # 낮은 준비도 날이 없으면 기울기를 알 수 없다 → 사전값(섞어도 c = 사전값)
    return {SENSITIVITY_KEY: round(float(c_user), 6), SUPPORT_KEY: int(n)}


def add_sensitivity_to_summary(result: dict, body, model, lookup, *, gb_enabled: bool) -> None:
    """AI06 응답 summaryU에 c_user를 넣는다. 실패하면 키를 넣지 않는다(읽는 쪽은 사전값)."""
    summary = result.get("summaryU")
    if not isinstance(summary, dict) or model is None or lookup is None:
        return
    try:
        from app.gru_gb import GAIN_KEY, OFFSET_KEY, parse_gb
        gain, offset = parse_gb(summary.get(GAIN_KEY), summary.get(OFFSET_KEY)) if gb_enabled else (1.0, 0.0)
        summary.update(compute_sensitivity(model, body, lookup, gain=gain, offset=offset))
    except Exception as exc:
        log_ai_error(UNAVAILABLE_WARNING, "/v1/hr/personalize", exc, level=logging.WARNING)


__all__ = ["C_PRIOR", "CachedReadinessLookup", "MAX_DROP_BPM", "MAX_RATIO_DROP", "NO_ADJUSTMENT", "READINESS_SQL",
           "READY_SCORE", "ReadinessAdjustment", "SENSITIVITY_KEY", "SHRINK_K", "SUPPORT_KEY", "adjustment",
           "add_sensitivity_to_summary", "blend", "compute_sensitivity", "deficit", "fit_sensitivity",
           "lower_thresholds", "parse_score", "ratio_drop", "readiness_enabled", "session_day", "user_adjustment"]
