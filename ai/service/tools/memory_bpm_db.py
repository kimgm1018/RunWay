"""BPM 기록 조회 SQL 4개(app/db_lookup.py BPM_*_SQL)를 메모리 표로 흉내 내는 가짜 DB.

running_sessions·running_metric_samples·session_control_events의 필요한 칸만 dict 목록으로 둔다.
SQL과 같은 조건(본인·완료·삭제 안 됨·최근 순 LIMIT, 속도 ≥ 1.5·케이던스 120~230·60초 칸, 적용된 SET_BPM·COACHING)을
적용한다. NULL은 SQL처럼 비교에서 빠진다. 테스트(S15P31E105-456)와 실제 러닝 재생(replay_cue_bpm.py)이 같이 쓴다.
`until`을 주면 그 시각까지 들어온 측정·BPM 변경만 보인다(러닝 중 재생용).
"""
import statistics

from app.db_lookup import BPM_EVENTS_SQL, BPM_RUNS_SQL, BPM_SESSION_SQL, BPM_WINDOWS_SQL


class MemoryBpmDb:
    def __init__(self, sessions=(), samples=(), events=(), fail=None):
        self.sessions, self.samples, self.events = list(sessions), list(samples), list(events)
        self.fail = fail              # 주면 모든 조회에서 이 예외를 낸다(DB 지연·장애 흉내)
        self.until = None
        self.calls = []

    def _check(self, sql):
        self.calls.append(sql)
        if self.fail is not None:
            raise self.fail

    def _visible(self, at):
        return self.until is None or at <= self.until

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self._check(sql)
        if sql != BPM_SESSION_SQL:
            raise AssertionError("모르는 SQL")
        row = next((s for s in self.sessions if s["id"] == params["session_id"]), None)
        if row is None:
            return None
        current = row["current_bpm"]
        if callable(current):         # 재생 중에는 그 시각에 켜져 있던 BPM
            current = current(self.until)
        return {"user_id": row["user_id"], "current_bpm": current}

    def fetch_all_with_timeout(self, sql, params, timeout_ms):
        self._check(sql)
        if sql == BPM_RUNS_SQL:
            runs = [s for s in self.sessions if s["user_id"] == params["user_id"] and s["status"] == "COMPLETED"
                    and s["deleted_at"] is None and s["ended_at"] is not None]
            runs.sort(key=lambda s: (s["ended_at"], s["id"]), reverse=True)
            return [{"id": s["id"]} for s in runs[:params["limit"]]]
        ids = set(params["session_ids"])
        if sql == BPM_WINDOWS_SQL:
            groups = {}
            for m in self.samples:
                if (m["session_id"] in ids and self._visible(m["at"])
                        and m["speed"] is not None and m["speed"] >= 1.5
                        and m["cadence"] is not None and 120 <= m["cadence"] <= 230):
                    groups.setdefault((m["session_id"], m["elapsed"] // 60), []).append(m)
            rows = []
            for (sid, bucket), ms in groups.items():
                sp, cad = [m["speed"] for m in ms], [m["cadence"] for m in ms]
                rows.append({"session_id": sid, "bucket": bucket, "n": len(ms),
                             "speed_mps": statistics.fmean(sp),
                             "speed_sd": statistics.stdev(sp) if len(sp) > 1 else None,
                             "cadence_spm": statistics.fmean(cad),
                             "cadence_sd": statistics.stdev(cad) if len(cad) > 1 else None,
                             "start_at": min(m["at"] for m in ms), "end_at": max(m["at"] for m in ms)})
            return rows
        if sql != BPM_EVENTS_SQL:
            raise AssertionError("모르는 SQL")
        out = [e for e in self.events if e["session_id"] in ids and self._visible(e["applied_at"])
               and e["result"] == "APPLIED" and e["action"] in ("SET_BPM", "COACHING")]
        return sorted(({"session_id": e["session_id"], "target_bpm": e["target_bpm"], "applied_at": e["applied_at"]}
                       for e in out), key=lambda e: (e["session_id"], e["applied_at"]))
