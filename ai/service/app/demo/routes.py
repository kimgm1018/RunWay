"""시연 콘솔 지도용 실제 러닝 경로(S15P31E105-722).

백엔드가 W07로 저장한 running_route_points를 AI 읽기 전용 DB 계정으로 읽는다. 백엔드 변경도 새 테이블도 없다.
- 콘솔 SSE가 연결돼 있는 동안만, 그리고 시연 버퍼에 이미 기록된(=718 대상 회원 규칙을 통과한) 세션만 읽는다.
- 개인(AI04): 시연 키 = running session id. 그룹(AI10): 참가자 userId별 진행 중 세션을 찾아 '러너 N'(참가자 순서) 선으로.
- 좌표는 메모리와 SSE로만 다룬다. 로그에는 좌표·회원 ID를 남기지 않는다.
"""
import logging
import threading
import time
from collections import deque
from datetime import datetime
from typing import Callable

from app.demo.buffer import is_group_key

log = logging.getLogger("runway.ai")

POLL_SEC = 3.0                 # 같은 시연 키를 DB에서 다시 읽는 최소 간격
SESSION_CACHE_SEC = 30.0       # 그룹 참가자의 진행 중 세션 ID를 다시 찾는 간격
MAX_POINTS_PER_ROUTE = 20000   # 메모리 상한(1초 간격이면 5시간)
MAX_SENT_POINTS = 1500         # SSE로 보내는 선 하나의 점 수 상한(고르게 솎음)
MAX_KEYS = 10                  # 738: 이전 기록(버퍼 MAX_SESSIONS)과 같게
IDLE_EXPIRE_SEC = 12 * 3600.0  # 738: 버퍼와 같게 12시간
DB_TIMEOUT_MS = 800
FETCH_LIMIT = 5000

# 회원당 진행 중 세션은 하나(V8 부분 유니크 인덱스 uq_running_sessions_active). 조건을 그 인덱스와 똑같이 둔다.
_RUNNING_SESSION_SQL = """
SELECT id FROM running_sessions
WHERE user_id = %(user_id)s AND status IN ('READY', 'RUNNING', 'PAUSED') AND state_version >= 1 AND deleted_at IS NULL
LIMIT 1
"""
# V31 인덱스 idx_running_route_points_session_measured(running_session_id, measured_at, id)로 마지막 읽은 시각 이후만 읽는다.
_POINTS_SQL = """
SELECT measured_at, ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lon
FROM running_route_points
WHERE running_session_id = %(session_id)s AND measured_at > %(after)s
ORDER BY measured_at
LIMIT %(limit)s
"""
_EPOCH = datetime.fromisoformat("1970-01-01T00:00:00+00:00")


class DbDemoRouteSource:
    """읽기 전용 조회 두 개. 권한: running_sessions SELECT, running_route_points(running_session_id, measured_at, position)."""

    def __init__(self, db, *, timeout_ms: int = DB_TIMEOUT_MS):
        self._db = db
        self._timeout_ms = timeout_ms

    def _fetch_all(self, sql: str, params: dict) -> list[dict]:
        if hasattr(self._db, "fetch_all_with_timeout"):
            return self._db.fetch_all_with_timeout(sql, params, self._timeout_ms)
        return self._db.fetch_all(sql, params)

    def running_session(self, user_id: int) -> int | None:
        rows = self._fetch_all(_RUNNING_SESSION_SQL, {"user_id": int(user_id)})
        return int(rows[0]["id"]) if rows else None

    def points_after(self, running_session_id: int, after: datetime | None) -> list[tuple[datetime, float, float]]:
        rows = self._fetch_all(_POINTS_SQL, {"session_id": int(running_session_id), "after": after or _EPOCH,
                                             "limit": FETCH_LIMIT})
        return [(row["measured_at"], float(row["lat"]), float(row["lon"])) for row in rows
                if row.get("lat") is not None and row.get("lon") is not None]


class _Route:
    def __init__(self):
        self.session_id: int | None = None
        self.last_at: datetime | None = None
        self.points: deque = deque(maxlen=MAX_POINTS_PER_ROUTE)


class _KeyState:
    def __init__(self):
        self.members: list[int | None] = []      # 그룹: 참가자 순서의 userId
        self.routes: dict[str, _Route] = {}
        self.user_sessions: dict[int, tuple[int | None, float]] = {}   # userId -> (진행 중 세션, 찾은 시각)
        self.last_poll = float("-inf")
        self.last_touch = 0.0
        self.version = 0


class DemoRoutes:
    def __init__(self, source, *, allowed_users: frozenset[int], monotonic: Callable[[], float] = time.monotonic,
                 poll_sec: float = POLL_SEC):
        self._source = source
        self._allowed = frozenset(int(u) for u in allowed_users)   # 718 userAllowlist. 그룹도 이 회원 선만 그린다
        self._monotonic = monotonic
        self._poll_sec = poll_sec
        self._lock = threading.Lock()
        self._keys: dict[int, _KeyState] = {}
        self._warned = False

    def _state(self, key: int) -> _KeyState:
        state = self._keys.get(key)
        if state is None:
            state = self._keys[key] = _KeyState()
        state.last_touch = self._monotonic()
        now = state.last_touch
        for other in [k for k, s in self._keys.items() if now - s.last_touch > IDLE_EXPIRE_SEC]:
            self._keys.pop(other, None)
        while len(self._keys) > MAX_KEYS:
            self._keys.pop(min(self._keys, key=lambda k: self._keys[k].last_touch), None)
        return state

    def set_group_members(self, key: int, user_ids: list[int | None]) -> None:
        """AI10 판단을 기록할 때 참가자 순서를 남긴다(콘솔의 '러너 N'과 같은 순서). 회원 ID는 SSE로 나가지 않는다."""
        with self._lock:
            self._state(key).members = list(user_ids)

    def due(self, key: int) -> bool:
        with self._lock:
            state = self._keys.get(key)
            return state is None or self._monotonic() - state.last_poll >= self._poll_sec

    def refresh(self, key: int) -> None:
        """새 좌표를 읽어 붙인다. 콘솔 SSE 루프에서만 부른다(구독이 없으면 DB를 읽지 않음). 실패는 조용히 넘긴다."""
        with self._lock:
            state = self._state(key)
            if self._monotonic() - state.last_poll < self._poll_sec:
                return
            state.last_poll = self._monotonic()
            members = list(state.members)
        try:
            if is_group_key(key):
                targets = []
                for index, user_id in enumerate(members):
                    if user_id is None or int(user_id) not in self._allowed:
                        continue
                    targets.append((f"러너 {index + 1}", self._group_session(key, int(user_id))))
            else:
                targets = [("러너", key)]
            changed = False
            for label, session_id in targets:
                if session_id is None:
                    continue
                with self._lock:
                    route = self._keys[key].routes.setdefault(label, _Route()) if key in self._keys else None
                    if route is None:
                        return
                    if route.session_id != session_id:        # 새 러닝이면 선을 새로 시작한다
                        route.session_id, route.last_at = session_id, None
                        route.points.clear()
                        changed = True
                    after = route.last_at
                points = self._source.points_after(session_id, after)
                if not points:
                    continue
                with self._lock:
                    route.points.extend((round(lat, 6), round(lon, 6)) for _, lat, lon in points)
                    route.last_at = points[-1][0]
                    changed = True
            if changed:
                with self._lock:
                    if key in self._keys:
                        self._keys[key].version += 1
        except Exception as exc:   # DB가 없거나 느려도 시연 SSE는 계속 돈다
            if not self._warned:
                log.warning("시연 경로 조회 실패(%s). 지도 선 없이 계속합니다", type(exc).__name__)
                self._warned = True

    def _group_session(self, key: int, user_id: int) -> int | None:
        with self._lock:
            cached = self._keys[key].user_sessions.get(user_id) if key in self._keys else None
        if cached is not None and self._monotonic() - cached[1] < SESSION_CACHE_SEC:
            return cached[0]
        session_id = self._source.running_session(user_id)
        if session_id is None and cached is not None:
            session_id = cached[0]                  # 방금 끝난 러닝이면 마지막 선을 그대로 둔다
        with self._lock:
            if key in self._keys:
                self._keys[key].user_sessions[user_id] = (session_id, self._monotonic())
        return session_id

    def state(self, key: int) -> tuple[int, list[dict]]:
        with self._lock:
            state = self._keys.get(key)
            if state is None:
                return 0, []
            routes = []
            for label in sorted(state.routes, key=_label_order):
                points = list(state.routes[label].points)
                if len(points) > MAX_SENT_POINTS:
                    step = (len(points) - 1) / (MAX_SENT_POINTS - 1)
                    points = [points[round(i * step)] for i in range(MAX_SENT_POINTS)]
                if points:
                    routes.append({"label": label, "points": [[lat, lon] for lat, lon in points]})
            return state.version, routes


def _label_order(label: str) -> int:
    tail = label.split()[-1]
    return int(tail) if tail.isdigit() else 0
