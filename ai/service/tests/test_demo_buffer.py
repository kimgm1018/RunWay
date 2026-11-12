from datetime import datetime, timedelta, timezone
from app.demo.buffer import DemoBuffer
T = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)
def tr(sec): return {"inputAsOf": (T + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")}


def make(allow=None):
    clock = {"t": T}
    return DemoBuffer("b", allowlist=allow, now=lambda: clock["t"]), clock


def test_prunes_older_than_10_min():
    b, _ = make(); [b.append(1, tr(s)) for s in (0, 300, 601)]
    assert [t["inputAsOf"] for t in b.traces(1)] == [tr(300)["inputAsOf"], tr(601)["inputAsOf"]]


def test_keeps_recent_sessions_up_to_limit_and_idle_expiry():
    # 738: 세션 10개까지, 마지막 기록 뒤 12시간 보관
    from app.demo.buffer import IDLE_EXPIRE_SEC, MAX_SESSIONS
    b, clock = make()
    for sid in range(1, MAX_SESSIONS + 2): b.append(sid, tr(0)); clock["t"] += timedelta(seconds=1)
    assert b.traces(1) == [] and b.traces(2) and b.latest_session() == MAX_SESSIONS + 1
    clock["t"] += timedelta(seconds=IDLE_EXPIRE_SEC + 1); b.append(99, tr(0))
    assert b.traces(MAX_SESSIONS + 1) == [] and b.traces(99)


def test_keeps_whole_run_but_live_views_stay_10_min():
    # 738: 러닝 전체를 보관(all_traces), 라이브 화면·판단 계산(traces·snapshot)은 그대로 최근 10분
    b, _ = make()
    for sec in range(0, 3600, 30): b.append(1, tr(sec))
    assert len(b.all_traces(1)) == 120
    live = b.traces(1)
    assert live[0]["inputAsOf"] == tr(2970)["inputAsOf"] and len(live) == 21
    traces, seq = b.snapshot(1)
    assert traces == live and seq == 120


def test_total_trace_cap_drops_oldest_session_first():
    import app.demo.buffer as buf
    b, clock = make()
    old_cap = buf.MAX_TOTAL_TRACES
    buf.MAX_TOTAL_TRACES = 10
    try:
        for sec in range(6): b.append(1, tr(sec))
        clock["t"] += timedelta(seconds=5)
        for sec in range(6): b.append(2, tr(sec))
        assert b.all_traces(1) == [] and len(b.all_traces(2)) == 6       # 오래된 세션 1을 통째로 지움
        for sec in range(6, 15): b.append(2, tr(sec))
        assert len(b.all_traces(2)) == 10                                # 혼자 남으면 앞부분만 덜어냄
    finally:
        buf.MAX_TOTAL_TRACES = old_cap


def test_sessions_list_newest_first_with_kind_duration_and_live():
    from app.demo.buffer import group_key
    b, clock = make()
    for sec in (0, 600, 1200): b.append(201, tr(sec))
    clock["t"] += timedelta(seconds=300)
    b.append(group_key(3), tr(1500))
    rows = b.sessions()
    assert [r["kind"] for r in rows] == ["GROUP", "PERSONAL"]
    personal = rows[1]
    assert personal["sessionId"] == 201 and personal["durationSec"] == 1200 and personal["traceCount"] == 3
    assert rows[0]["live"] is True and personal["live"] is False                # 300초 전 기록은 끝난 것으로
    assert "userId" not in str(rows)


def test_allowlist_and_since():
    b, _ = make(frozenset({7}))
    assert b.allowed(7) and not b.allowed(8)
    b.append(7, tr(0)); s = b.next_seq(); b.append(7, tr(5))
    assert len(b.since(7, 0)) == 2 and len(b.since(7, 1)) == 1


def test_subscribe_limit_and_release():
    b, _ = make()
    assert b.subscribe(1) and b.subscribe(1) and not b.subscribe(1)
    b.unsubscribe(1); assert b.subscribe(1)
