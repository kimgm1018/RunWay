"""세션별 판단 기록을 메모리에 보관하고 구독 슬롯을 관리한다."""
import threading
from collections import deque
from datetime import datetime, timedelta
from typing import Callable

from app.demo.course import _haversine

# 라이브 화면이 쓰는 창(콘솔 TRACE_WINDOW_SEC와 같음). 라이브 SNAPSHOT·판단 계산(traces)은 이 창만 본다.
WINDOW_SEC = 600.0
# 738 '이전 기록': 러닝 전체를 메모리에 보관한다(재시작·재배포하면 사라짐). 상한은 trace 수로 묶는다.
#   trace 1개 = 개인 약 6 KB(JSON)·28 KB(파이썬 객체), 그룹 약 4 KB·17 KB(후보 9개 실측).
#   MAX_TOTAL_TRACES 3000 x 28 KB = 약 84 MB가 최악(전부 개인). 경로 점(세션당 최대 1만 점)까지 약 105 MB.
RETAIN_SEC = 3 * 3600.0           # 세션당 최근 3시간(시연 러닝 전체)
MAX_TRACES_PER_SESSION = 2200     # 5초 간격 개인 판단 약 3시간
MAX_TOTAL_TRACES = 3000           # 전체 상한. 넘으면 가장 오래된 세션부터 통째로 지운다
MAX_SESSIONS = 10
IDLE_EXPIRE_SEC = 12 * 3600.0     # 마지막 기록 뒤 12시간 보관
LIVE_AFTER_SEC = 120.0            # 마지막 기록이 이보다 최근이면 '진행 중'
MAX_SUBSCRIBERS = 2
MAX_ROUTE_POINTS = 10000
MAX_COURSE_SUMMARY_POINTS = 500
# 그룹 러닝 스트림 키. Nginx 경로(/v1/demo/sessions/(latest|[0-9]+)/events)를 바꾸지 않도록 숫자 키를 쓰고,
# 개인 세션 ID와 겹치지 않게 큰 값을 더한다. 콘솔은 ?group=<groupRunId>를 이 키로 바꿔 연결한다.
GROUP_KEY_OFFSET = 9_000_000_000_000


def group_key(group_run_id: int) -> int:
    return GROUP_KEY_OFFSET + int(group_run_id)


def is_group_key(key: int) -> bool:
    return key >= GROUP_KEY_OFFSET


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class DemoBuffer:
    def __init__(self, boot_id: str, *, allowlist: frozenset[int] | None,
                 now: Callable[[], datetime], group_allowlist: frozenset[int] | None = None):
        self.boot_id = boot_id
        self.allowlist = allowlist
        self.group_allowlist = group_allowlist
        self.now = now
        self._lock = threading.Lock()
        self._seq = 0
        self._records: dict[int, deque] = {}
        self._route_points: dict[int, deque] = {}
        self._route_version: dict[int, int] = {}
        self._last_add: dict[int, datetime] = {}
        self._latest_input: dict[int, float] = {}
        self._subscribers: dict[int, int] = {}

    def allowed(self, session_id: int) -> bool:
        if is_group_key(session_id):
            return self.group_allowlist is None or session_id - GROUP_KEY_OFFSET in self.group_allowlist
        return self.allowlist is None or session_id in self.allowlist

    def next_seq(self) -> int:
        with self._lock:
            self._seq += 1
            return self._seq

    def _expire(self, current: datetime) -> None:
        for sid, last in list(self._last_add.items()):
            if (current - last).total_seconds() > IDLE_EXPIRE_SEC:
                self._drop(sid)

    def _drop(self, sid: int) -> None:
        self._last_add.pop(sid, None)
        self._records.pop(sid, None)
        self._route_points.pop(sid, None)
        self._route_version.pop(sid, None)
        self._subscribers.pop(sid, None)
        self._latest_input.pop(sid, None)

    def _make_room(self, keep: int | None = None) -> None:
        while len(self._last_add) > MAX_SESSIONS:
            self._drop(min(self._last_add, key=self._last_add.get))
        # 738: 전체 trace 수 상한. 방금 기록한 세션(keep)이 아닌 가장 오래된 세션부터 통째로 지운다
        while sum(len(r) for r in self._records.values()) > MAX_TOTAL_TRACES:
            others = [sid for sid in self._records if sid != keep]
            if others:
                self._drop(min(others, key=lambda sid: self._last_add[sid]))
            else:
                self._records[keep].popleft()

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
            at = _time(trace["inputAsOf"]).timestamp()
            latest = max(at, self._latest_input.get(session_id, at))
            self._latest_input[session_id] = latest
            # 738: 러닝 전체 보관(최근 RETAIN_SEC, MAX_TRACES_PER_SESSION). 기록은 거의 시간 순이라 앞에서부터 덜어낸다
            cutoff = latest - RETAIN_SEC
            while records and (len(records) > MAX_TRACES_PER_SESSION
                               or _time(records[0][1]["inputAsOf"]).timestamp() < cutoff):
                records.popleft()
            self._make_room(keep=session_id)

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
            self._make_room(keep=session_id)

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

    def _window(self, session_id: int, window_sec: float | None) -> list:
        records = sorted(self._records.get(session_id, ()), key=lambda pair: _time(pair[1]["inputAsOf"]))
        if window_sec is None or not records:
            return records
        cutoff = self._latest_input.get(session_id, _time(records[-1][1]["inputAsOf"]).timestamp()) - window_sec
        return [pair for pair in records if _time(pair[1]["inputAsOf"]).timestamp() >= cutoff]

    def traces(self, session_id: int) -> list[dict]:
        """라이브 창(최근 WINDOW_SEC)의 기록. 판단 계산·라이브 화면용(738 전과 같은 의미)."""
        with self._lock:
            self._expire(self.now())
            return [trace for _, trace in self._window(session_id, WINDOW_SEC)]

    def all_traces(self, session_id: int) -> list[dict]:
        """738 '이전 기록' 다시 보기: 보관 중인 러닝 전체."""
        with self._lock:
            self._expire(self.now())
            return [trace for _, trace in self._window(session_id, None)]

    def sessions(self) -> list[dict]:
        """738 '이전 기록' 목록(최근 순). 회원 ID·좌표는 넣지 않는다."""
        with self._lock:
            current = self.now()
            self._expire(current)
            out = []
            for sid in sorted(self._last_add, key=self._last_add.get, reverse=True):
                records = self._window(sid, None)
                if not records:
                    continue
                first, last = records[0][1], records[-1][1]
                start, end = _time(first["inputAsOf"]), _time(last["inputAsOf"])
                out.append({"sessionId": sid, "kind": "GROUP" if is_group_key(sid) else "PERSONAL",
                            "startedAt": first["inputAsOf"], "lastAt": last["inputAsOf"],
                            "durationSec": round((end - start).total_seconds()), "traceCount": len(records),
                            "live": (current - self._last_add[sid]).total_seconds() < LIVE_AFTER_SEC})
            return out

    def since(self, session_id: int, seq: int) -> list[tuple[int, dict]]:
        with self._lock:
            current = self.now()
            self._expire(current)
            return [(record_seq, trace) for record_seq, trace in self._records.get(session_id, ()) if record_seq > seq]

    def snapshot(self, session_id: int) -> tuple[list[dict], int]:
        """라이브 SNAPSHOT: 라이브 창 기록과, 이후 MPC_TRACE를 이어 받을 seq(보관 중 전체의 최대)."""
        with self._lock:
            self._expire(self.now())
            records = list(self._records.get(session_id, ()))
            traces = [trace for _, trace in self._window(session_id, WINDOW_SEC)]
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
