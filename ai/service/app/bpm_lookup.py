"""AI04 목표 BPM에 쓸 사용자 기록을 팀 DB에서 읽는다(S15P31E105-438).

백엔드는 context.bpm을 보내지 않고, AI가 읽기 전용 DB에서 직접 만든다.
  - 지난 기록: 그 사용자의 최근 완료 러닝에서 페이스가 일정한 60초 구간(속도·케이던스·그때 BPM)
  - 첫 1분: 이번 세션의 첫 일정 구간(지난 기록이 없을 때 bpm_cue가 한 번 보정에 쓴다)
그 구간에 켜져 있던 BPM은 session_control_events의 적용된 SET_BPM·COACHING으로 되짚는다.
러닝 시작 때 처음 튼 BPM은 DB에 남지 않으므로, 첫 BPM 변경 전 구간과 구간 안에서 BPM이 바뀐 구간은 뺀다.
이번 세션은 아직 BPM을 바꾼 적이 없으면 running_sessions.current_bpm이 처음 튼 BPM이다.
"""
import logging
import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

from app.ai_logging import log_ai_error
from app.db_lookup import BPM_EVENTS_SQL, BPM_RUNS_SQL, BPM_SESSION_SQL, BPM_WINDOWS_SQL
from app.decide.schemas import BpmInput, BpmRecord, BpmSample

UNAVAILABLE_WARNING = "BPM_RECORDS_UNAVAILABLE"
MIN_SAMPLES = 4          # 구간 안 최소 측정 수
MAX_SPEED_CV = 0.05      # 속도 변동계수 상한(페이스가 일정한 구간만)
MAX_CADENCE_SD = 5.0     # 케이던스 표준편차 상한(spm)
FETCH_RUNS = 40          # select_records가 BPM을 따라간 구간이 있는 최근 20회를 고르므로 여유 있게 읽는다
MAX_RECORDS = 2000       # context.bpm.records 상한과 같다. 최근 러닝 구간부터 담는다


def _num(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def is_steady(row: dict) -> bool:
    n, speed, cadence = row.get("n") or 0, _num(row.get("speed_mps")), _num(row.get("cadence_spm"))
    speed_sd, cadence_sd = _num(row.get("speed_sd")), _num(row.get("cadence_sd"))
    if n < MIN_SAMPLES or None in (speed, cadence, speed_sd, cadence_sd) or speed <= 0:
        return False
    return speed_sd / speed <= MAX_SPEED_CV and cadence_sd <= MAX_CADENCE_SD


def cue_bpm_at(events: list[dict], start, end, initial_bpm=None) -> float | None:
    """구간 [start, end]에 켜져 있던 BPM. 알 수 없으면 None(그 구간은 쓰지 않는다)."""
    if any(start < e["applied_at"] <= end for e in events):
        return None                                       # 구간 안에서 BPM이 바뀜
    before = [e for e in events if e["applied_at"] <= start]
    if before:
        return _num(before[-1]["target_bpm"])
    return _num(initial_bpm) if not events else None      # 바꾼 적이 없을 때만 처음 BPM을 안다


def usable_windows(rows: list[dict], events: list[dict], initial_bpm=None) -> list[tuple[dict, float]]:
    """일정 구간 중 그때 BPM을 아는 구간만 (행, BPM)으로 시간순으로 돌려준다."""
    out = []
    for row in sorted(rows, key=lambda r: r["bucket"]):
        if not is_steady(row):
            continue
        cue = cue_bpm_at(events, row["start_at"], row["end_at"], initial_bpm)
        if cue is not None:
            out.append((row, cue))
    return out


@dataclass(frozen=True)
class BpmLookupResult:
    bpm_input: BpmInput | None = None
    warning: str | None = None


class CachedDbBpmLookup:
    """지난 기록은 사용자별 300초 캐시, 이번 세션 첫 1분은 찾으면 세션별로 기억한다. DB 조회 제한 300ms."""

    def __init__(self, db, *, ttl_sec: float = 300, max_entries: int = 1024, timeout_ms: int = 300,
                 monotonic=time.monotonic):
        self.db = db
        self.ttl_sec = max(0.0, float(ttl_sec))
        self.max_entries = max(0, int(max_entries))
        self.timeout_ms = max(1, int(timeout_ms))
        self.monotonic = monotonic
        self._records: OrderedDict[int, tuple[float, list[BpmRecord]]] = OrderedDict()
        self._first: OrderedDict[int, BpmSample] = OrderedDict()
        self._lock = threading.RLock()

    def _all(self, sql, params) -> list[dict]:
        fetch = getattr(self.db, "fetch_all_with_timeout", None)
        return fetch(sql, params, self.timeout_ms) if callable(fetch) else self.db.fetch_all(sql, params)

    def _one(self, sql, params) -> dict | None:
        fetch = getattr(self.db, "fetch_one_with_timeout", None)
        return fetch(sql, params, self.timeout_ms) if callable(fetch) else self.db.fetch_one(sql, params)

    def _remember(self, cache: OrderedDict, key, value) -> None:
        """lock을 잡은 채 부른다."""
        if self.max_entries <= 0:
            return
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > self.max_entries:
            cache.popitem(last=False)

    # lock은 캐시를 읽고 쓸 때만 잡고 DB는 lock 밖에서 읽는다. lock을 잡은 채 읽으면 느린 DB 한 번에
    # 모든 러너의 AI04가 줄을 선다(S15P31E105-500).
    def _past_records(self, user_id: int) -> list[BpmRecord]:
        now = self.monotonic()
        with self._lock:
            cached = self._records.get(user_id)
            if cached is not None and cached[0] > now:
                return cached[1]
        run_ids = [r["id"] for r in self._all(BPM_RUNS_SQL, {"user_id": user_id, "limit": FETCH_RUNS})]
        records = []
        if run_ids:
            rows = self._all(BPM_WINDOWS_SQL, {"session_ids": run_ids})
            events = self._all(BPM_EVENTS_SQL, {"session_ids": run_ids})
            run_no = {sid: len(run_ids) - i for i, sid in enumerate(run_ids)}   # 최근일수록 큰 번호
            for sid in run_ids:
                session_events = [e for e in events if e["session_id"] == sid]
                for row, cue in usable_windows([r for r in rows if r["session_id"] == sid], session_events):
                    records.append(BpmRecord(run_no=run_no[sid], speed_mps=_num(row["speed_mps"]),
                                             cadence_spm=_num(row["cadence_spm"]), cue_bpm=cue))
        if self.ttl_sec > 0:
            with self._lock:
                self._remember(self._records, user_id, (now + self.ttl_sec, records))
        return records

    def _first_minute(self, session_id: int, current_bpm) -> BpmSample | None:
        with self._lock:
            if session_id in self._first:
                return self._first[session_id]
        rows = self._all(BPM_WINDOWS_SQL, {"session_ids": [session_id]})
        events = self._all(BPM_EVENTS_SQL, {"session_ids": [session_id]})
        steady = [r for r in sorted(rows, key=lambda r: r["bucket"]) if is_steady(r)]
        if not steady:
            return None                                   # 아직 없다. 다음 요청에서 다시 본다
        first = steady[0]
        cue = cue_bpm_at(events, first["start_at"], first["end_at"], current_bpm)
        sample = BpmSample(speed_mps=_num(first["speed_mps"]), cadence_spm=_num(first["cadence_spm"]), cue_bpm=cue)
        with self._lock:
            if session_id in self._first:          # 같은 세션 요청이 동시에 찾았으면 먼저 기억한 첫 1분을 쓴다
                return self._first[session_id]
            self._remember(self._first, session_id, sample)
        return sample

    def get_for_session(self, session_id: int) -> BpmLookupResult:
        try:
            session = self._one(BPM_SESSION_SQL, {"session_id": int(session_id)})
            if session is None:
                return BpmLookupResult()
            records = self._past_records(int(session["user_id"]))
            first = self._first_minute(int(session_id), session.get("current_bpm"))
            return BpmLookupResult(BpmInput(records=records[:MAX_RECORDS], first_minute=first))
        except Exception as exc:
            log_ai_error(UNAVAILABLE_WARNING, "/v1/pace/decide", exc, level=logging.WARNING)
            return BpmLookupResult(warning=UNAVAILABLE_WARNING)


class UnavailableBpmLookup:
    """AI_DB_URL은 있는데 시작 때 DB 연결에 실패했을 때 쓴다. 평균 BPM + 경고."""

    def get_for_session(self, session_id: int) -> BpmLookupResult:
        return BpmLookupResult(warning=UNAVAILABLE_WARNING)
