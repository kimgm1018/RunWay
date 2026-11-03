"""세션별 판단 기록을 메모리에 보관하고 구독 슬롯을 관리한다."""
import threading
from collections import deque
from datetime import datetime, timedelta
from typing import Callable

from app.demo.course import _haversine

WINDOW_SEC = 600.0
MAX_SESSIONS = 3
IDLE_EXPIRE_SEC = 1800.0
MAX_SUBSCRIBERS = 2
MAX_ROUTE_POINTS = 10000
MAX_COURSE_SUMMARY_POINTS = 500


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class DemoBuffer:
    def __init__(self, boot_id: str, *, allowlist: frozenset[int] | None,
                 now: Callable[[], datetime]):
        self.boot_id = boot_id
        self.allowlist = allowlist
        self.now = now
        self._lock = threading.Lock()
        self._seq = 0
        self._records: dict[int, deque] = {}
        self._route_points: dict[int, deque] = {}
        self._route_version: dict[int, int] = {}
        self._last_add: dict[int, datetime] = {}
        self._subscribers: dict[int, int] = {}

    def allowed(self, session_id: int) -> bool:
        return self.allowlist is None or session_id in self.allowlist

    def next_seq(self) -> int:
        with self._lock:
            self._seq += 1
            return self._seq

    def _expire(self, current: datetime) -> None:
        for sid, last in list(self._last_add.items()):
            if (current - last).total_seconds() > IDLE_EXPIRE_SEC:
                self._last_add.pop(sid, None)
                self._records.pop(sid, None)
                self._route_points.pop(sid, None)
                self._route_version.pop(sid, None)
                self._subscribers.pop(sid, None)

    def _make_room(self) -> None:
        while len(self._last_add) > MAX_SESSIONS:
            oldest = min(self._last_add, key=self._last_add.get)
            self._records.pop(oldest, None)
            self._route_points.pop(oldest, None)
            self._route_version.pop(oldest, None)
            self._last_add.pop(oldest, None)
            self._subscribers.pop(oldest, None)

    def append(self, session_id: int, trace: dict) -> None:
        with self._lock:
            current = self.now()
            self._expire(current)
            record_seq = trace.get("_bufferSeq")
            self._seq += 1
            record_seq = self._seq if record_seq is None else record_seq
            records = self._records.setdefault(session_id, deque())
            records.append((record_seq, trace))
            self._last_add[session_id] = current
            latest = max((_time(item[1]["inputAsOf"]) for item in records), default=None)
            if latest is not None:
                cutoff = latest.timestamp() - WINDOW_SEC
                kept = [(seq, item) for seq, item in records if _time(item["inputAsOf"]).timestamp() >= cutoff]
                records.clear()
                records.extend(kept)
            self._make_room()

    def append_route_points(self, session_id: int, points) -> None:
        ordered = sorted(points, key=lambda point: point.measuredAt)
        if not ordered:
            return
        with self._lock:
            current = self.now()
            self._expire(current)
            route = self._route_points.setdefault(session_id, deque(maxlen=MAX_ROUTE_POINTS))
            route.extend((point.measuredAt, float(point.coordinates[0]), float(point.coordinates[1]),
                          None if point.altitudeM is None else float(point.altitudeM)) for point in ordered)
            self._route_version[session_id] = self._route_version.get(session_id, 0) + 1
            self._last_add[session_id] = current
            self._make_room()

    @staticmethod
    def _summarize_route(route) -> dict | None:
        if len(route) < 2:
            return None
        distances = [0.0]
        for previous, current in zip(route, route[1:]):
            distances.append(distances[-1] + _haversine(previous[1], previous[2], current[1], current[2]))
        if len(route) > MAX_COURSE_SUMMARY_POINTS:
            indices = sorted({round(i * (len(route) - 1) / (MAX_COURSE_SUMMARY_POINTS - 1))
                              for i in range(MAX_COURSE_SUMMARY_POINTS)})
        else:
            indices = range(len(route))
        points = [[route[i][1], route[i][2], route[i][3], round(distances[i], 2)] for i in indices]
        return {"lengthM": round(distances[-1], 2), "points": points}

    def course_state(self, session_id: int) -> tuple[int, dict | None]:
        with self._lock:
            self._expire(self.now())
            route = sorted(self._route_points.get(session_id, ()), key=lambda point: point[0])
            version = self._route_version.get(session_id, 0)
        return version, self._summarize_route(route)

    def course_summary(self, session_id: int) -> dict | None:
        return self.course_state(session_id)[1]

    def traces(self, session_id: int) -> list[dict]:
        with self._lock:
            current = self.now()
            self._expire(current)
            return [trace for _, trace in sorted(self._records.get(session_id, ()), key=lambda pair: _time(pair[1]["inputAsOf"]))]

    def since(self, session_id: int, seq: int) -> list[tuple[int, dict]]:
        with self._lock:
            current = self.now()
            self._expire(current)
            return [(record_seq, trace) for record_seq, trace in self._records.get(session_id, ()) if record_seq > seq]

    def snapshot(self, session_id: int) -> tuple[list[dict], int]:
        with self._lock:
            self._expire(self.now())
            records = list(self._records.get(session_id, ()))
            traces = [trace for _, trace in sorted(records, key=lambda pair: _time(pair[1]["inputAsOf"]))]
            high_watermark = max((seq for seq, _ in records), default=0)
            return traces, high_watermark

    def latest_session(self) -> int | None:
        with self._lock:
            self._expire(self.now())
            return max(self._last_add, key=self._last_add.get) if self._last_add else None

    def subscribe(self, session_id: int) -> bool:
        with self._lock:
            count = self._subscribers.get(session_id, 0)
            if count >= MAX_SUBSCRIBERS:
                return False
            self._subscribers[session_id] = count + 1
            return True

    def unsubscribe(self, session_id: int) -> None:
        with self._lock:
            count = self._subscribers.get(session_id, 0)
            if count <= 1:
                self._subscribers.pop(session_id, None)
            else:
                self._subscribers[session_id] = count - 1
