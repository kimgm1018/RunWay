"""시연 콘솔 실시간 측정값(S15P31E105-912).

AI 판단(MPC_TRACE)은 그룹 30초·개인 2분마다라서 콘솔 숫자가 그동안 멈춰 있다. 워치는 약 5초마다 측정값을
백엔드에 올리고 백엔드는 running_metric_samples에 저장한다. 그 마지막 값을 AI 읽기 전용 DB 계정으로 읽어
LIVE_METRICS SSE로 보낸다. 722 지도 경로(routes.py)와 같은 규칙이다.
- 기본 꺼짐. demo_config liveMetricsSec(3~30초)가 있고 userAllowlist가 정해졌을 때만 켠다.
- 콘솔 SSE가 연결돼 있는 동안만, 시연 버퍼에 이미 기록된 세션만 읽는다. 개인 세션은 버퍼 기록만으로는 대상 회원인지
  알 수 없으므로(AI08 inlet은 회원 확인 없이 기록한다) running_sessions.user_id가 userAllowlist 안일 때만 읽는다(리뷰 A-1).
  그룹은 참가자 중 userAllowlist 회원만 '러너 N'(지도와 같은 라벨·세션)으로 읽는다.
- 회원 ID·세션 ID는 SSE로 보내지 않는다. 로그에 심박·회원 ID를 남기지 않는다.
- 실제 페이스는 콘솔 기존 기준(724, '최근 60초 평균')과 같게 최근 60초 속도 평균으로 만든다.
"""
import logging
import threading
import time
from datetime import timezone
from typing import Callable

from app.demo.buffer import is_group_key
from app.demo.routes import demo_db_slot

log = logging.getLogger("runway.ai")

WINDOW_SEC = 60          # 실제 페이스 평균 창(콘솔 ACTUAL_WINDOW_TEXT '최근 60초 평균'과 같다)
HR_FRESH_SEC = 15        # 마지막 측정 심박이 최신 행보다 이만큼 넘게 오래됐으면 보이지 않는다(센서 끊김)
DISTANCE_FRESH_SEC = 30  # 최신 행의 거리가 비어 있으면(칸 하나만 있는 행) 이만큼 안의 마지막 거리를 쓴다
FETCH_LIMIT = 120        # 1초 간격 저장이어도 60초 창을 덮는다
DB_TIMEOUT_MS = 800
MAX_KEYS = 40            # 버퍼 MAX_SESSIONS·지도와 같게
MAX_OWNER_CACHE = 200
IDLE_EXPIRE_SEC = 7 * 24 * 3600.0

# V23 인덱스 idx_running_metric_samples_session_measured(running_session_id, measured_at DESC, id DESC)를 탄다.
# id 칸 권한은 주지 않으므로 measured_at으로만 정렬한다.
_SAMPLES_SQL = """
SELECT measured_at, elapsed_duration, heart_rate, is_hr_measured, speed, total_distance
FROM running_metric_samples
WHERE running_session_id = %(session_id)s
ORDER BY measured_at DESC
LIMIT %(limit)s
"""
_OWNER_SQL = """
SELECT user_id FROM running_sessions WHERE id = %(session_id)s LIMIT 1
"""


class DbDemoMetricSource:
    """읽기 전용 조회 둘. 권한: running_metric_samples(running_session_id, measured_at, elapsed_duration,
    heart_rate, is_hr_measured, speed, total_distance) SELECT, running_sessions SELECT(기존).
    infra/ai/grant-readonly.sh 참조. 지도 조회와 같은 DB 슬롯(연결 1개)을 쓴다."""

    def __init__(self, db, *, timeout_ms: int = DB_TIMEOUT_MS):
        self._db = db
        self._timeout_ms = timeout_ms

    def _fetch_all(self, sql: str, params: dict) -> list[dict]:
        with demo_db_slot():
            if hasattr(self._db, "fetch_all_with_timeout"):
                return self._db.fetch_all_with_timeout(sql, params, self._timeout_ms)
            return self._db.fetch_all(sql, params)

    def recent(self, running_session_id: int) -> list[dict]:
        """최근 측정값 행(최신이 먼저)."""
        return self._fetch_all(_SAMPLES_SQL, {"session_id": int(running_session_id), "limit": FETCH_LIMIT})

    def owner(self, running_session_id: int) -> int | None:
        """세션 소유 회원 ID. 세션이 없으면 None."""
        rows = self._fetch_all(_OWNER_SQL, {"session_id": int(running_session_id)})
        return int(rows[0]["user_id"]) if rows and rows[0].get("user_id") is not None else None


def _num(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _r(value, digits=2):
    return round(value, digits) if value is not None else None


def summarize(rows: list[dict]) -> dict | None:
    """최신이 먼저인 행에서 콘솔 한 줄 값을 만든다. 행이 없으면 None."""
    if not rows:
        return None
    latest = rows[0]
    end = _num(latest.get("elapsed_duration"))
    if end is None:
        return None
    speeds = [s for r in rows
              if (e := _num(r.get("elapsed_duration"))) is not None and end - WINDOW_SEC < e <= end
              and (s := _num(r.get("speed"))) is not None and s >= 0]
    speed = sum(speeds) / len(speeds) if speeds else None
    pace = 1000.0 / speed if speed is not None and speed > 0 else None
    hr = None
    for r in rows:
        e = _num(r.get("elapsed_duration"))
        if e is None or end - e > HR_FRESH_SEC:
            break
        value = _num(r.get("heart_rate"))
        if r.get("is_hr_measured") is True and value is not None and value > 0:
            hr = value
            break
    distance = None                      # 칸 하나만 있는 행이 섞여 와도 거리가 null로 깜박이지 않게 마지막 값을 쓴다
    for r in rows:
        e = _num(r.get("elapsed_duration"))
        if e is None or end - e > DISTANCE_FRESH_SEC:
            break
        value = _num(r.get("total_distance"))
        if value is not None and value >= 0:
            distance = value
            break
    measured = latest.get("measured_at")
    if measured is not None and getattr(measured, "tzinfo", None) is not None:
        measured_text = measured.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        measured_text = None
    return {"hrBpm": _r(hr, 1), "speedMps": _r(speed, 3), "paceSecPerKm": _r(pace, 1),
            "distanceM": _r(distance, 1), "elapsedSec": int(end), "measuredAt": measured_text}


class _KeyState:
    def __init__(self):
        self.runners: dict[str, dict] = {}
        self.last_poll = float("-inf")
        self.last_touch = 0.0
        self.version = 0


class DemoLiveMetrics:
    def __init__(self, source, *, targets: Callable[[int], list[tuple[str, int | None]]], every_sec: float,
                 allowed_users: frozenset[int], monotonic: Callable[[], float] = time.monotonic):
        self._source = source
        self._targets = targets          # DemoRoutes.targets: 지도와 같은 라벨·세션, 목록 밖 회원 제외
        self._every = float(every_sec)
        self._allowed = frozenset(int(u) for u in allowed_users)   # 718 userAllowlist
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._keys: dict[int, _KeyState] = {}
        self._owner_ok: dict[int, bool] = {}   # 세션 ID -> 소유 회원이 대상인지(세션 소유자는 바뀌지 않는다). 조회 실패는 담지 않는다
        self._warned = False

    def _state(self, key: int) -> _KeyState:
        state = self._keys.get(key)
        if state is None:
            state = self._keys[key] = _KeyState()
        now = state.last_touch = self._monotonic()
        for other in [k for k, s in self._keys.items() if now - s.last_touch > IDLE_EXPIRE_SEC]:
            self._keys.pop(other, None)
        while len(self._keys) > MAX_KEYS:
            self._keys.pop(min(self._keys, key=lambda k: self._keys[k].last_touch), None)
        return state

    def due(self, key: int) -> bool:
        with self._lock:
            state = self._keys.get(key)
            return state is None or self._monotonic() - state.last_poll >= self._every

    def _session_allowed(self, session_id: int) -> bool:
        """개인 세션이 대상 회원의 것인지. 확인하지 못하면 읽지 않는다(예외는 호출자가 처리하고 다음 주기에 다시 확인)."""
        with self._lock:
            cached = self._owner_ok.get(session_id)
        if cached is not None:
            return cached
        owner = self._source.owner(session_id)
        allowed = owner is not None and owner in self._allowed
        with self._lock:
            if len(self._owner_ok) >= MAX_OWNER_CACHE:
                self._owner_ok.clear()
            self._owner_ok[session_id] = allowed
        return allowed

    def refresh(self, key: int) -> None:
        """최신 측정값을 읽는다. 콘솔 SSE에서만 부른다(구독이 없으면 DB를 읽지 않음). 실패는 조용히 넘긴다."""
        with self._lock:
            state = self._state(key)
            if self._monotonic() - state.last_poll < self._every:
                return
            state.last_poll = self._monotonic()
        try:
            personal = not is_group_key(key)
            fresh: dict[str, dict] = {}
            failed: set[str] = set()
            for label, session_id in self._targets(key):
                if session_id is None:
                    continue                      # 진행 중 세션이 없으면 그 라벨 값은 지운다
                try:
                    if personal and not self._session_allowed(session_id):
                        continue                  # 대상 회원의 세션이 아니면 읽지 않는다(심박 칸은 조회하지 않음)
                    summary = summarize(self._source.recent(session_id))
                except Exception as exc:          # 한 명의 조회 실패가 다른 러너를 막지 않는다. 그 러너는 마지막 값을 둔다
                    failed.add(label)
                    if not self._warned:
                        log.warning("시연 실시간 측정값 조회 실패(%s). 판단 값만으로 계속합니다", type(exc).__name__)
                        self._warned = True
                    continue
                if summary is not None:
                    fresh[label] = summary
            with self._lock:
                state = self._keys.get(key)
                if state is None:
                    return
                merged = dict(fresh)
                for label in failed:
                    if label in state.runners:
                        merged[label] = state.runners[label]
                if merged != state.runners:      # 이번 대상에서 사라진 라벨(이탈·순서 변경)은 지운다
                    state.runners = merged
                    state.version += 1
        except Exception as exc:   # 대상 조회 실패 등. DB가 없거나 느려도 시연 SSE는 계속 돈다
            if not self._warned:
                log.warning("시연 실시간 측정값 조회 실패(%s). 판단 값만으로 계속합니다", type(exc).__name__)
                self._warned = True

    def state(self, key: int) -> tuple[int, list[dict]]:
        with self._lock:
            state = self._keys.get(key)
            if state is None:
                return 0, []
            return state.version, [{"label": label, **state.runners[label]}
                                   for label in sorted(state.runners, key=_label_order)]


def _label_order(label: str) -> int:
    tail = label.split()[-1]
    return int(tail) if tail.isdigit() else 0
