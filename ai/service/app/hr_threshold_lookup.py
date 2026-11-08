"""AI04에서 사용자 학습 심박 기준을 빠르고 안전하게 읽는다."""
from collections import OrderedDict
from dataclasses import dataclass
import logging
import math
import threading
import time
from decimal import Decimal

from app.ai_logging import log_ai_error
from app.db_lookup import DatabaseUnavailable, HR_THRESHOLD_SQL, MISSING_RELATION_SQLSTATES

log = logging.getLogger("runway.ai")
UNAVAILABLE_WARNING = "HR_THRESHOLD_LOOKUP_UNAVAILABLE"
INVALID_WARNING = "HR_THRESHOLD_LOOKUP_INVALID"


@dataclass(frozen=True)
class HrThresholdLookupResult:
    hr_danger_bpm: float | None = None
    hr_sustain_bpm: float | None = None
    hr_threshold_run_count: int = 0
    warning: str | None = None

    @property
    def has_thresholds(self) -> bool:
        return self.hr_danger_bpm is not None and self.hr_sustain_bpm is not None


def _bpm(value) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = float(value)
    return number if math.isfinite(number) and 35.0 <= number <= 220.0 else None


class CachedDbHrThresholdLookup:
    """사용자별 기준 캐시: 결과 300초, 행 없음 60초, DB 조회 제한 300ms."""

    def __init__(self, db, *, ttl_sec: float = 300, empty_ttl_sec: float = 60,
                 max_users: int = 1024, timeout_ms: int = 300, monotonic=time.monotonic):
        self.db = db
        self.ttl_sec = max(0.0, float(ttl_sec))
        self.empty_ttl_sec = max(0.0, float(empty_ttl_sec))
        self.max_users = max(0, int(max_users))
        self.timeout_ms = max(1, int(timeout_ms))
        self.monotonic = monotonic
        self._cache: OrderedDict[int, tuple[float, HrThresholdLookupResult]] = OrderedDict()
        self._lock = threading.RLock()

    def _read(self, user_id: int) -> HrThresholdLookupResult:
        try:
            fetch = getattr(self.db, "fetch_one_with_timeout", None)
            row = (fetch(HR_THRESHOLD_SQL, {"user_id": user_id}, self.timeout_ms)
                   if callable(fetch) else self.db.fetch_one(HR_THRESHOLD_SQL, {"user_id": user_id}))
        except DatabaseUnavailable as exc:
            if exc.sqlstate not in MISSING_RELATION_SQLSTATES:
                log_ai_error(UNAVAILABLE_WARNING, "/v1/pace/decide", exc, level=logging.WARNING)
            return HrThresholdLookupResult(warning=UNAVAILABLE_WARNING)
        except Exception as exc:
            log_ai_error(UNAVAILABLE_WARNING, "/v1/pace/decide", exc, level=logging.WARNING)
            return HrThresholdLookupResult(warning=UNAVAILABLE_WARNING)
        if row is None:
            return HrThresholdLookupResult()

        danger = _bpm(row.get("hr_danger_bpm"))
        sustain = _bpm(row.get("hr_sustain_bpm"))
        count = row.get("hr_threshold_run_count")
        if danger is None and sustain is None and count in (None, 0):
            return HrThresholdLookupResult()
        if (danger is None or sustain is None or isinstance(count, bool) or not isinstance(count, int)
                or not 0 <= count <= 20 or sustain > danger):
            log_ai_error(INVALID_WARNING, "/v1/pace/decide", ValueError(), level=logging.WARNING)
            return HrThresholdLookupResult(warning=INVALID_WARNING)
        return HrThresholdLookupResult(danger, sustain, count)

    def get_for_user(self, user_id: int) -> HrThresholdLookupResult:
        user_id = int(user_id)
        now = self.monotonic()
        with self._lock:
            cached = self._cache.get(user_id)
            if cached is not None and cached[0] > now:
                self._cache.move_to_end(user_id)
                return cached[1]
            self._cache.pop(user_id, None)
        # DB는 lock 밖에서 읽는다. lock을 잡은 채 읽으면 느린 DB 한 번에 모든 러너의 AI04가 줄을 선다(S15P31E105-500).
        result = self._read(user_id)
        cacheable = result.warning is None and self.max_users > 0
        has_thresholds = result.has_thresholds and result.hr_threshold_run_count > 0
        ttl = self.ttl_sec if has_thresholds else self.empty_ttl_sec
        if cacheable and ttl > 0:
            with self._lock:
                self._cache[user_id] = (now + ttl, result)
                self._cache.move_to_end(user_id)
                while len(self._cache) > self.max_users:
                    self._cache.popitem(last=False)
        return result


__all__ = ["CachedDbHrThresholdLookup", "HrThresholdLookupResult", "HR_THRESHOLD_SQL",
           "INVALID_WARNING", "UNAVAILABLE_WARNING"]
