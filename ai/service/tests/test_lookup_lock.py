"""S15P31E105-500: 심박 기준·BPM 기록 조회는 DB를 부르는 동안 프로세스 전체 lock을 잡지 않는다.

느린 가짜 DB가 동시에 진행 중인 쿼리 수의 최댓값을 센다. lock을 잡은 채 DB를 부르면 늘 1이다.
시간 측정에 기대지 않으므로 느린 CI에서도 흔들리지 않는다.
"""
import threading
import time
from datetime import datetime, timedelta, timezone

from app.bpm_lookup import CachedDbBpmLookup
from app.hr_threshold_lookup import CachedDbHrThresholdLookup
from tools.memory_bpm_db import MemoryBpmDb

USERS = 4
DB_SEC = 0.05


class Overlap:
    """동시에 진행 중인 DB 호출 수를 센다."""

    def __init__(self):
        self.now = 0
        self.peak = 0
        self._lock = threading.Lock()

    def __enter__(self):
        with self._lock:
            self.now += 1
            self.peak = max(self.peak, self.now)
        time.sleep(DB_SEC)

    def __exit__(self, *exc):
        with self._lock:
            self.now -= 1


def run_together(fn, args):
    start = threading.Barrier(len(args))
    out = [None] * len(args)

    def work(i, a):
        start.wait()
        out[i] = fn(a)

    threads = [threading.Thread(target=work, args=(i, a)) for i, a in enumerate(args)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    return out


class SlowThresholdDb:
    def __init__(self):
        self.overlap = Overlap()
        self.calls = 0

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        with self.overlap:
            self.calls += 1
            return {"hr_danger_bpm": 180.0, "hr_sustain_bpm": 165.0, "hr_threshold_run_count": 12}


def test_hr_threshold_reads_for_different_users_run_at_the_same_time():
    db = SlowThresholdDb()
    lookup = CachedDbHrThresholdLookup(db)
    results = run_together(lookup.get_for_user, list(range(1, USERS + 1)))
    assert db.overlap.peak >= 2                       # lock 밖에서 읽어 줄을 서지 않는다
    assert all(r.hr_danger_bpm == 180.0 and r.warning is None for r in results)


def test_hr_threshold_cache_still_works():
    db = SlowThresholdDb()
    lookup = CachedDbHrThresholdLookup(db)
    lookup.get_for_user(7)
    lookup.get_for_user(7)
    assert db.calls == 1                              # 두 번째는 캐시


BASE = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)


class SlowBpmDb(MemoryBpmDb):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.overlap = Overlap()

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        with self.overlap:
            return super().fetch_one_with_timeout(sql, params, timeout_ms)

    def fetch_all_with_timeout(self, sql, params, timeout_ms):
        with self.overlap:
            return super().fetch_all_with_timeout(sql, params, timeout_ms)


def bpm_db():
    db = SlowBpmDb()
    for user in range(1, USERS + 1):
        sid = 100 + user
        db.sessions.append({"id": sid, "user_id": user, "status": "RUNNING", "deleted_at": None,
                            "ended_at": None, "current_bpm": 160})
        for sec in range(0, 60, 5):
            db.samples.append({"session_id": sid, "elapsed": sec, "at": BASE + timedelta(seconds=sec),
                               "speed": 2.8 + 0.01 * (sec % 3), "cadence": 158.0 + 0.1 * (sec % 3)})
    return db


def test_bpm_reads_for_different_sessions_run_at_the_same_time():
    db = bpm_db()
    lookup = CachedDbBpmLookup(db)
    results = run_together(lookup.get_for_session, [100 + u for u in range(1, USERS + 1)])
    assert db.overlap.peak >= 2
    assert all(r.warning is None and r.bpm_input.first_minute.cue_bpm == 160.0 for r in results)


def test_same_session_racing_keeps_one_first_minute():
    db = bpm_db()
    lookup = CachedDbBpmLookup(db)
    results = run_together(lookup.get_for_session, [101] * USERS)
    firsts = [r.bpm_input.first_minute for r in results]
    assert all(f == firsts[0] for f in firsts)         # 먼저 기억한 첫 1분 하나만 쓴다
    assert lookup.get_for_session(101).bpm_input.first_minute == firsts[0]
