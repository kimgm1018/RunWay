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


def test_keeps_three_recent_sessions_and_idle_expiry():
    b, clock = make()
    for sid in (1, 2, 3, 4): b.append(sid, tr(0)); clock["t"] += timedelta(seconds=1)
    assert b.traces(1) == [] and b.latest_session() == 4
    clock["t"] += timedelta(seconds=1801); b.append(5, tr(0))
    assert b.traces(4) == [] and b.traces(5)


def test_allowlist_and_since():
    b, _ = make(frozenset({7}))
    assert b.allowed(7) and not b.allowed(8)
    b.append(7, tr(0)); s = b.next_seq(); b.append(7, tr(5))
    assert len(b.since(7, 0)) == 2 and len(b.since(7, 1)) == 1


def test_subscribe_limit_and_release():
    b, _ = make()
    assert b.subscribe(1) and b.subscribe(1) and not b.subscribe(1)
    b.unsubscribe(1); assert b.subscribe(1)
