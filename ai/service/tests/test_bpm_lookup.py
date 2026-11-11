"""AI04 목표 BPM 개인 기록 DB 조회(S15P31E105-438)를 가짜 DB로 확인한다."""
from datetime import datetime, timedelta, timezone

from app.bpm_cue import CueBpmCalculator
from app.bpm_lookup import (UNAVAILABLE_WARNING, CachedDbBpmLookup, UnavailableBpmLookup, cue_bpm_at,
                            is_steady, usable_windows)
from app.db_lookup import BPM_EVENTS_SQL, BPM_RUNS_SQL, BPM_SESSION_SQL, BPM_WINDOWS_SQL
from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from demo_fakes import FakeModel5, FakePolicy, decide_body

T = datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc)
CALC = CueBpmCalculator()
tb = CALC._tb


def window(session_id, bucket, speed=2.8, cadence=166.0, n=12, speed_sd=0.05, cadence_sd=1.5, start=T):
    begin = start + timedelta(seconds=60 * bucket)
    return {"session_id": session_id, "bucket": bucket, "n": n, "speed_mps": speed, "speed_sd": speed_sd,
            "cadence_spm": cadence, "cadence_sd": cadence_sd, "start_at": begin,
            "end_at": begin + timedelta(seconds=55)}


def event(session_id, minute, bpm, start=T):
    return {"session_id": session_id, "target_bpm": bpm, "applied_at": start + timedelta(seconds=60 * minute)}


class FakeDb:
    """SQL 상수별로 미리 정한 행을 돌려준다. 호출 기록으로 캐시를 확인한다."""

    def __init__(self, session=None, runs=(), windows=(), events=(), fail=False):
        self.session, self.runs, self.windows, self.events, self.fail = session, list(runs), list(windows), list(events), fail
        self.calls = []

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self.calls.append(sql)
        if self.fail:
            raise RuntimeError("db down")
        assert sql == BPM_SESSION_SQL
        return self.session

    def fetch_all_with_timeout(self, sql, params, timeout_ms):
        self.calls.append(sql)
        if sql == BPM_RUNS_SQL:
            return [{"id": i} for i in self.runs]
        ids = set(params["session_ids"])
        rows = self.windows if sql == BPM_WINDOWS_SQL else self.events
        assert sql in (BPM_WINDOWS_SQL, BPM_EVENTS_SQL)
        return [r for r in rows if r["session_id"] in ids]


# --- 구간 고르기 ---------------------------------------------------------------

def test_steady_window_rules():
    assert is_steady(window(1, 0))
    assert not is_steady(window(1, 0, n=3))                    # 측정이 너무 적음
    assert not is_steady(window(1, 0, speed_sd=0.3))           # 페이스가 흔들림(변동계수 > 5%)
    assert not is_steady(window(1, 0, cadence_sd=6.0))         # 케이던스가 흔들림


def test_cue_bpm_follows_applied_changes_and_skips_unknown():
    events = [event(1, 2.5, 160), event(1, 5.5, 165)]
    assert cue_bpm_at(events, T, T + timedelta(seconds=55)) is None                       # 첫 변경 전: 모름
    assert cue_bpm_at(events, T + timedelta(minutes=3), T + timedelta(minutes=3, seconds=55)) == 160
    assert cue_bpm_at(events, T + timedelta(minutes=5), T + timedelta(minutes=5, seconds=55)) is None  # 구간 안 변경
    assert cue_bpm_at(events, T + timedelta(minutes=6), T + timedelta(minutes=6, seconds=55)) == 165
    assert cue_bpm_at([], T, T + timedelta(seconds=55), initial_bpm=158) == 158          # 바꾼 적 없으면 처음 BPM


def test_usable_windows_keeps_time_order():
    rows = [window(1, 4), window(1, 3), window(1, 0)]
    got = usable_windows(rows, [event(1, 2.5, 160)])
    assert [(r["bucket"], cue) for r, cue in got] == [(3, 160.0), (4, 160.0)]


# --- DB 조회 ------------------------------------------------------------------

def test_records_user_gets_recent_runs_with_known_bpm():
    t2 = T + timedelta(days=1)
    db = FakeDb(session={"user_id": 7, "current_bpm": 165}, runs=[12, 11],          # 최근 순
                windows=[window(11, 0), window(11, 3), window(12, 3, start=t2), window(99, 0)],
                events=[event(11, 1, 160), event(12, 1, 170, start=t2)])
    result = CachedDbBpmLookup(db).get_for_session(500)
    recs = result.bpm_input.records
    assert result.warning is None
    assert [(r.run_no, r.cue_bpm) for r in recs] == [(2, 170.0), (1, 160.0)]          # 11번 첫 구간은 BPM을 몰라 뺌


def test_new_user_first_minute_uses_current_bpm_until_first_change():
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, runs=[],
                windows=[window(500, 0, n=2), window(500, 1, speed=2.78, cadence=157.0)])
    first = CachedDbBpmLookup(db).get_for_session(500).bpm_input.first_minute
    assert (first.speed_mps, first.cadence_spm, first.cue_bpm) == (2.78, 157.0, 158.0)


def test_first_minute_is_remembered_per_session_and_records_cached_per_user():
    now = [0.0]
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, runs=[], windows=[window(500, 0)])
    lookup = CachedDbBpmLookup(db, monotonic=lambda: now[0])
    a = lookup.get_for_session(500).bpm_input.first_minute
    db.windows = [window(500, 0, cadence=170.0)]                                       # 나중에 값이 바뀌어도
    b = lookup.get_for_session(500).bpm_input.first_minute
    assert a == b                                                                      # 같은 첫 1분(반복 보정 없음)
    assert db.calls.count(BPM_RUNS_SQL) == 1                                            # 지난 기록은 캐시
    now[0] = 301.0
    lookup.get_for_session(500)
    assert db.calls.count(BPM_RUNS_SQL) == 2                                            # 300초 뒤 다시 읽음


def test_unknown_session_and_db_failure():
    assert CachedDbBpmLookup(FakeDb(session=None)).get_for_session(1).bpm_input is None
    failed = CachedDbBpmLookup(FakeDb(fail=True)).get_for_session(1)
    assert failed.bpm_input is None and failed.warning == UNAVAILABLE_WARNING
    assert UnavailableBpmLookup().get_for_session(1).warning == UNAVAILABLE_WARNING


# --- AI04 연결 -----------------------------------------------------------------

def go(body, lookup):
    req = DecideRequest.model_validate(body)
    at = datetime(2026, 11, 5, 5, 16, 38, tzinfo=timezone.utc)
    return run_decide(req, FakeModel5(), FakePolicy(), received_at=at, now=lambda: at,
                      cue_bpm_calc=CALC, bpm_lookup=lookup)


def test_decide_uses_db_records_when_context_bpm_missing():
    db = FakeDb(session={"user_id": 7, "current_bpm": 165}, runs=[11],
                windows=[window(11, 3, cadence=176.0)], events=[event(11, 1, 175)])
    d = go(decide_body(), CachedDbBpmLookup(db)).response.decision
    expected = tb.target_bpm(d.recommended_pace_sec_per_km, CALC.prior,
                             records=tb.select_records([tb.Window(1, 2.8, 176.0, 175.0)])).bpm
    assert d.cue_bpm == expected != tb.target_bpm(d.recommended_pace_sec_per_km, CALC.prior).bpm


def test_context_bpm_wins_over_db_for_tests_and_demo():
    db = FakeDb(session={"user_id": 7, "current_bpm": 165})
    go(decide_body(bpm={"records": [], "firstMinute": None}), CachedDbBpmLookup(db))
    assert db.calls == []                                                              # DB를 읽지 않음


def test_db_failure_still_gives_average_bpm_with_warning():
    r = go(decide_body(), CachedDbBpmLookup(FakeDb(fail=True))).response
    assert r.decision.cue_bpm == tb.target_bpm(r.decision.recommended_pace_sec_per_km, CALC.prior).bpm
    assert UNAVAILABLE_WARNING in r.warnings


# --- 세션 캐시(BPM_LOOKUP_CACHE_ENABLED) ------------------------------------------

def _states():
    """같은 세션이 진행되는 동안의 DB 모습. 켬·끔 조회기에 똑같이 넣는다."""
    return [
        dict(current_bpm=158, windows=[], events=[]),                                         # 아직 구간 없음
        dict(current_bpm=162, windows=[window(500, 0, n=2)], events=[]),                      # 일정 구간 아님, BPM 바뀜
        dict(current_bpm=165, windows=[window(500, 0, n=2), window(500, 1, speed=2.78, cadence=157.0)], events=[]),
        dict(current_bpm=170, windows=[window(500, 1, speed=2.78, cadence=157.0), window(500, 4, cadence=171.0)],
             events=[event(500, 3, 170)]),                                                    # 첫 1분 뒤 BPM 변경
        dict(current_bpm=None, windows=[window(500, 1, cadence=180.0)], events=[event(500, 0.5, 175)]),
    ]


def _run_states(db, lookup):
    out = []
    for st in _states():
        db.session = {"user_id": 7, "current_bpm": st["current_bpm"]}
        db.windows, db.events = st["windows"], st["events"]
        out.append((lookup.get_for_session(500), go(decide_body(), lookup).response.decision.cue_bpm))
    return out


def test_session_cache_gives_same_cue_bpm_as_old_path():
    for runs, past in (([], []), ([11], [window(11, 3, cadence=176.0)])):                     # 처음 사용자 / 기록 사용자
        on_db = FakeDb(runs=runs, windows=past, events=[event(11, 1, 175)])
        off_db = FakeDb(runs=runs, windows=past, events=[event(11, 1, 175)])
        on = _run_states(on_db, CachedDbBpmLookup(on_db, session_cache=True))
        off = _run_states(off_db, CachedDbBpmLookup(off_db, session_cache=False))
        assert on == off
        assert on[2][0].bpm_input.first_minute.cue_bpm == 165.0                               # 찾을 때의 current_bpm


def test_session_sql_is_skipped_after_first_minute_is_known():
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, windows=[])
    lookup = CachedDbBpmLookup(db, session_cache=True)
    lookup.get_for_session(500)
    assert db.calls.count(BPM_SESSION_SQL) == 1 and db.calls.count(BPM_EVENTS_SQL) == 0       # 일정 구간 없으면 이벤트 안 읽음
    lookup.get_for_session(500)
    assert db.calls.count(BPM_SESSION_SQL) == 2                                                # 첫 1분 전에는 매번 읽음
    db.windows = [window(500, 0)]
    lookup.get_for_session(500)                                                                # 첫 1분을 찾음
    before = len(db.calls)
    for _ in range(5):
        lookup.get_for_session(500)
    assert db.calls[before:] == []                                                             # 이후 DB 0회(지난 기록은 300초 캐시)


def test_cache_off_env_keeps_old_sql_path(monkeypatch):
    monkeypatch.setenv("BPM_LOOKUP_CACHE_ENABLED", "false")
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, windows=[])
    lookup = CachedDbBpmLookup(db)
    assert lookup.session_cache is False
    lookup.get_for_session(500)
    assert db.calls == [BPM_SESSION_SQL, BPM_RUNS_SQL, BPM_WINDOWS_SQL, BPM_EVENTS_SQL]       # 예전 순서 그대로
    db.windows = [window(500, 0)]
    lookup.get_for_session(500)
    db.calls.clear()
    lookup.get_for_session(500)
    assert db.calls == [BPM_SESSION_SQL]                                                       # 매번 세션 SQL
    monkeypatch.setenv("BPM_LOOKUP_CACHE_ENABLED", "true")
    assert CachedDbBpmLookup(db).session_cache is True
    monkeypatch.delenv("BPM_LOOKUP_CACHE_ENABLED")
    assert CachedDbBpmLookup(db).session_cache is True                                        # 기본 켬


def test_session_cache_expires_and_is_bounded():
    now = [0.0]
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, windows=[window(s, 0) for s in (1, 2, 3)])
    lookup = CachedDbBpmLookup(db, session_cache=True, session_ttl_sec=10, max_entries=2, monotonic=lambda: now[0])
    lookup.get_for_session(1)
    lookup.get_for_session(1)
    assert db.calls.count(BPM_SESSION_SQL) == 1
    now[0] = 11.0                                                                              # 만료
    lookup.get_for_session(1)
    assert db.calls.count(BPM_SESSION_SQL) == 2
    lookup.get_for_session(2)
    lookup.get_for_session(3)
    assert len(lookup._users) <= 2 and len(lookup._first) <= 2                                 # 상한
    assert 1 not in lookup._users
    n = db.calls.count(BPM_SESSION_SQL)
    lookup.get_for_session(1)                                                                  # 밀려난 세션은 다시 읽음
    assert db.calls.count(BPM_SESSION_SQL) == n + 1


def test_evicted_first_minute_is_recomputed_with_current_bpm():
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, windows=[window(1, 0), window(2, 0)])
    lookup = CachedDbBpmLookup(db, session_cache=True, max_entries=1)
    a = lookup.get_for_session(1).bpm_input.first_minute
    lookup.get_for_session(2)                                                                  # 1의 첫 1분이 밀려남
    b = lookup.get_for_session(1).bpm_input.first_minute
    assert a == b and b.cue_bpm == 158.0                                                       # current_bpm 없이 계산하지 않음


def test_session_cache_is_thread_safe():
    import threading
    db = FakeDb(session={"user_id": 7, "current_bpm": 158}, runs=[11],
                windows=[window(11, 3, cadence=176.0)] + [window(s, 0) for s in range(100, 140)],
                events=[event(11, 1, 175)])
    lookup = CachedDbBpmLookup(db, session_cache=True, max_entries=8)
    want = {s: CachedDbBpmLookup(FakeDb(session=db.session, runs=db.runs, windows=db.windows, events=db.events),
                                 session_cache=False).get_for_session(s) for s in range(100, 140)}
    errors, got = [], []

    def worker(k):
        try:
            for i in range(200):
                s = 100 + (i * 7 + k) % 40
                got.append((s, lookup.get_for_session(s)))
        except Exception as exc:   # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(k,)) for k in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors and all(r == want[s] for s, r in got)
    assert len(lookup._users) <= 8 and len(lookup._first) <= 8
