"""개인 계획용 팀 DB(PostgreSQL) 읽기 전용 조회 어댑터.

- 연결: env AI_DB_URL(읽기 전용 계정). 없으면 어댑터를 만들지 않아 개인 계획은 503 NOT_READY.
- SQL은 모두 바인딩 파라미터만 쓴다. URL·비밀번호·드라이버 오류 원문은 로그와 응답에 남기지 않는다.
- 개인화 테이블은 팀 DB에 아직 없다. release 제안 `user_hr_personalization`(migration 번호는 V10 이상, 팀이 정함)
  기준이며 이름·컬럼은 아래 상수다. ERD가 오면 개인화 SQL과 변환을 함께 바꾼다.
- 코스 경사 찾는 순서: ① 백엔드가 저장한 경사(StoredCourseGradeSource, 기본 꺼짐) ② courses.elevation_profile 계산
  ③ RouteElevationSource ④ 0% 평지(MISSING). 저장 형식이 정해지면 StoredCourseGradeSource 구현을 만들어
  DbCourseLookup(stored_grade_source=...)으로 넘긴다(app/main.py). 테이블 이름은 아직 정하지 않았다.
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import json
import logging
from typing import Protocol

from app.course_grade import MAX_STORED_GRADE_SEGMENTS, elevation_to_grade_profile
from app.ai_logging import log_ai_error
from app.inference import ApiError
from app.ode_schemas import PlanGradeSegment
from app.personal_plan import CoursePlanSnapshot, UserPersonalizationSnapshot
from app.planner import prerun_planner
from app.speed_calibration import (SPEED_REF_MAX_DURATION_SEC, SPEED_REF_RECENT_RUNS, SPEED_REF_VALID_RANGE_MPS,
                                   speed_ref_from_runs)

log = logging.getLogger("runway.ai")

STATEMENT_TIMEOUT_MS = 2000
CONNECT_TIMEOUT_SEC = 2
POOL_TIMEOUT_SEC = 2.0
POOL_MAX_SIZE = 2

COURSE_SQL = """SELECT id, distance, elevation_profile, status::text AS status, updated_at
FROM courses
WHERE id = %(course_id)s"""

# 팀 DB에 없는 제안 테이블(release 제안 docs/design/db/proposals/ai_personalization.sql).
PERSONALIZATION_TABLE = "user_hr_personalization"
PERSONALIZATION_COLUMNS = ("user_id", "personalization_version", "schema_version", "model_version",
                           "support_run_count", "summary_u_json", "history8_json", "p4_json",
                           "hr0_sub_bpm", "hr_ref_bpm", "hr_danger_bpm", "hr_sustain_bpm",
                           "hr_threshold_run_count", "created_at")
PERSONALIZATION_SQL = (f"SELECT {', '.join(PERSONALIZATION_COLUMNS)}\nFROM {PERSONALIZATION_TABLE}\n"
                       "WHERE user_id = %(user_id)s\nORDER BY personalization_version DESC\nLIMIT 1")

# AI09 속도 보정 v_ref(S15P31E105-402): 계획 시각 이전에 끝난 완료 러닝 최근 20회의 이동 속도.
# 범위는 app/speed_calibration.py(SPEED_REF_VALID_RANGE_MPS, SPEED_REF_MAX_DURATION_SEC)와 같다.
SPEED_REF_SQL = """SELECT total_distance, moving_duration, elapsed_duration
FROM running_sessions
WHERE user_id = %(user_id)s
  AND status = 'COMPLETED'
  AND deleted_at IS NULL
  AND ended_at IS NOT NULL
  AND ended_at <= %(cutoff)s
  AND total_distance > 0
  AND moving_duration > 0
  AND GREATEST(moving_duration, COALESCE(elapsed_duration, 0)) <= %(max_duration_sec)s
  AND total_distance / moving_duration BETWEEN %(min_speed_mps)s AND %(max_speed_mps)s
ORDER BY ended_at DESC, id DESC
LIMIT %(limit)s"""
SPEED_REF_UNAVAILABLE_WARNING = "SPEED_REF_LOOKUP_UNAVAILABLE"

HR_THRESHOLD_COLUMNS = ("user_id", "personalization_version", "hr_danger_bpm", "hr_sustain_bpm",
                        "hr_threshold_run_count")
HR_THRESHOLD_SQL = (f"SELECT {', '.join(HR_THRESHOLD_COLUMNS)}\nFROM {PERSONALIZATION_TABLE}\n"
                    "WHERE user_id = %(user_id)s\nORDER BY personalization_version DESC\nLIMIT 1")

# 제안 GRU 개인화 테이블. 팀 ERD가 바뀌면 이 상수와 변환 검사를 함께 갱신한다.
GRU_PERSONALIZATION_TABLE = "user_gru_personalization"
GRU_PERSONALIZATION_COLUMNS = (
    "user_id", "personalization_version", "schema_version", "model_version", "model_sha256",
    "support_run_count", "support_window_count", "head_json", "created_at",
)
GRU_PERSONALIZATION_SQL = (
    f"SELECT {', '.join(GRU_PERSONALIZATION_COLUMNS)}\nFROM {GRU_PERSONALIZATION_TABLE}\n"
    "WHERE user_id = %(user_id)s\nORDER BY personalization_version DESC\nLIMIT 1"
)

# AI04 목표 BPM 개인 기록(S15P31E105-438). runway_ai는 아래 칸만 읽을 수 있다(infra/ai/grant-readonly.sh).
BPM_SESSION_SQL = """SELECT user_id, current_bpm
FROM running_sessions
WHERE id = %(session_id)s"""

BPM_RUNS_SQL = """SELECT id
FROM running_sessions
WHERE user_id = %(user_id)s
  AND status = 'COMPLETED'
  AND deleted_at IS NULL
  AND ended_at IS NOT NULL
ORDER BY ended_at DESC, id DESC
LIMIT %(limit)s"""

# 60초 칸별 평균·표준편차. 걷기·정지와 이상값은 먼저 뺀다(ai/bpm/convert_personal.py와 같은 기준).
BPM_WINDOWS_SQL = """SELECT running_session_id AS session_id,
       FLOOR(elapsed_duration / 60) AS bucket,
       COUNT(*) AS n,
       AVG(speed) AS speed_mps,
       STDDEV_SAMP(speed) AS speed_sd,
       AVG(cadence) AS cadence_spm,
       STDDEV_SAMP(cadence) AS cadence_sd,
       MIN(measured_at) AS start_at,
       MAX(measured_at) AS end_at
FROM running_metric_samples
WHERE running_session_id = ANY(%(session_ids)s)
  AND speed >= 1.5
  AND cadence BETWEEN 120 AND 230
GROUP BY running_session_id, FLOOR(elapsed_duration / 60)"""

BPM_EVENTS_SQL = """SELECT session_id, target_bpm, applied_at
FROM session_control_events
WHERE session_id = ANY(%(session_ids)s)
  AND result = 'APPLIED'
  AND action IN ('SET_BPM', 'COACHING')
ORDER BY session_id, applied_at"""

# 개인화 테이블이 팀 DB에 아직 없을 때(ERD 전)의 SQLSTATE: 42P01 undefined_table, 42703 undefined_column.
MISSING_RELATION_SQLSTATES = frozenset({"42P01", "42703"})


class DatabaseUnavailable(Exception):
    """연결 실패·시간 초과·드라이버 오류. 메시지는 예외 종류 이름만, sqlstate는 드라이버가 준 5자리 코드만 담는다."""

    def __init__(self, name: str, *, sqlstate: str | None = None):
        super().__init__(name)
        self.sqlstate = sqlstate


def _sqlstate(exc: BaseException) -> str | None:
    # psycopg 예외는 sqlstate 속성을 가진다. 드라이버가 없거나 연결 오류면 None.
    value = getattr(exc, "sqlstate", None)
    return value if isinstance(value, str) and len(value) == 5 and value.isalnum() else None


class Database(Protocol):
    def fetch_one(self, sql: str, params: dict) -> dict | None: ...

    def fetch_all(self, sql: str, params: dict) -> list[dict]: ...


class RouteElevationSource(Protocol):
    """GPS 경로 + DEM으로 고도 프로파일을 만드는 자리. AI 컨테이너에는 DEM이 없어 구현하지 않는다."""

    def elevation_profile_for(self, course_id: int) -> list | None: ...


class StoredCourseGradeSource(Protocol):
    """백엔드가 코스 저장 때 계산해 둔 경사를 읽는 자리. 저장 형식(테이블·구간 길이)은 팀 결정 전이라 구현이 없다.

    courses 한 행(COURSE_SQL 결과)을 받아 순서 있는 PlanGradeSegment 목록을 돌려준다. 없으면 None.
    구간 길이는 가정하지 않는다(1 km든 100 m든). 0 m부터 끊김 없이 코스 끝까지, 450개 이하여야 쓴다.
    DB 오류는 DatabaseUnavailable로 올린다.
    """

    def grade_profile_for(self, course_row: dict) -> Sequence[PlanGradeSegment] | None: ...


class PsycopgDatabase:
    """psycopg 3 + psycopg_pool. 드라이버는 AI_DB_URL이 있을 때만 import한다."""

    def __init__(self, url: str, *, pool=None, statement_timeout_ms: int = STATEMENT_TIMEOUT_MS,
                 pool_timeout_sec: float = POOL_TIMEOUT_SEC, max_size: int = POOL_MAX_SIZE):
        if pool is None:
            from psycopg_pool import ConnectionPool
            pool = ConnectionPool(url, min_size=1, max_size=max_size, open=False, timeout=pool_timeout_sec,
                                  name="runway-ai-readonly",
                                  kwargs=self.connect_kwargs(statement_timeout_ms=statement_timeout_ms))
        self._pool = pool
        self._pool_timeout_sec = pool_timeout_sec
        self._opened = False

    @staticmethod
    def connect_kwargs(*, statement_timeout_ms: int = STATEMENT_TIMEOUT_MS) -> dict:
        kwargs = {"connect_timeout": CONNECT_TIMEOUT_SEC,
                  "options": f"-c statement_timeout={int(statement_timeout_ms)} -c default_transaction_read_only=on"}
        try:
            from psycopg.rows import dict_row
            kwargs["row_factory"] = dict_row
        except ImportError:
            pass
        return kwargs

    def _run(self, sql: str, params: dict, many: bool, *, timeout_ms: int | None = None):
        try:
            if not self._opened:
                self._pool.open(wait=False)
                self._opened = True
            connection_timeout = self._pool_timeout_sec if timeout_ms is None else max(1, int(timeout_ms)) / 1000.0
            with self._pool.connection(timeout=connection_timeout) as conn:
                with conn.cursor() as cursor:
                    if timeout_ms is not None:
                        cursor.execute("SELECT set_config('statement_timeout', %s, true)", (f"{max(1, int(timeout_ms))}ms",))
                    cursor.execute(sql, params)
                    return cursor.fetchall() if many else cursor.fetchone()
        except Exception as exc:
            name = type(exc).__name__
            sqlstate = _sqlstate(exc)
            log_ai_error("AI_DB_UNAVAILABLE", "database", exc, level=logging.WARNING)
            raise DatabaseUnavailable(name, sqlstate=sqlstate) from None

    def fetch_one(self, sql: str, params: dict) -> dict | None:
        return self._run(sql, params, many=False)

    def fetch_one_with_timeout(self, sql: str, params: dict, timeout_ms: int) -> dict | None:
        """한 번의 읽기에만 짧은 풀 대기·statement timeout을 적용한다."""
        return self._run(sql, params, many=False, timeout_ms=timeout_ms)

    def fetch_all(self, sql: str, params: dict) -> list[dict]:
        return list(self._run(sql, params, many=True) or [])

    def fetch_all_with_timeout(self, sql: str, params: dict, timeout_ms: int) -> list[dict]:
        return list(self._run(sql, params, many=True, timeout_ms=timeout_ms) or [])

    def close(self) -> None:
        try:
            self._pool.close()
        except Exception as exc:
            log_ai_error("AI_DB_CLOSE_FAILED", "shutdown", exc, level=logging.WARNING)


def default_db_factory(url: str) -> Database:
    return PsycopgDatabase(url)


def _unavailable() -> ApiError:
    return ApiError(503, "AI_DB_UNAVAILABLE", "개인 계획에 필요한 DB 조회를 지금 할 수 없습니다.")


def _json(value):
    if isinstance(value, (str, bytes)):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _float(value) -> float | None:
    return None if value is None else float(value)


def _stored_grade(distance: float, value) -> tuple[PlanGradeSegment, ...] | None:
    """저장된 경사가 기존 개인 계획 검사를 통과할 모양일 때만 쓴다. 아니면 None(다음 단계로)."""
    if not isinstance(value, Sequence) or not value or len(value) > MAX_STORED_GRADE_SEGMENTS:
        return None
    if not all(isinstance(segment, PlanGradeSegment) for segment in value):
        return None
    if abs(value[0].start_distance_m) > 1e-6:
        return None
    if any(abs(b.start_distance_m - a.end_distance_m) > 1e-6 for a, b in zip(value, value[1:])):
        return None
    if abs(value[-1].end_distance_m - distance) > prerun_planner.COURSE_DISTANCE_TOL_M:
        return None
    return tuple(value)


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None if value is None else str(value)


class DbCourseLookup:
    """courses 한 행 → 코스 거리·순서 있는 경사. ACTIVE가 아니면 없는 코스로 본다."""

    def __init__(self, db: Database, *, elevation_source: RouteElevationSource | None = None,
                 stored_grade_source: StoredCourseGradeSource | None = None):
        self.db = db
        self.elevation_source = elevation_source
        self.stored_grade_source = stored_grade_source

    def get_course(self, course_id: int) -> CoursePlanSnapshot | None:
        try:
            row = self.db.fetch_one(COURSE_SQL, {"course_id": int(course_id)})
        except DatabaseUnavailable:
            raise _unavailable() from None
        if row is None or row.get("status") != "ACTIVE":
            return None
        distance = float(row["distance"])
        version = f"courses:{int(row['id'])}:{_iso(row.get('updated_at'))}"
        grade, source = None, "COURSE_STORED_GRADE"
        if self.stored_grade_source is not None:
            try:
                stored = self.stored_grade_source.grade_profile_for(row)
            except DatabaseUnavailable:
                raise _unavailable() from None
            grade = _stored_grade(distance, stored)
            if grade is None and stored is not None:
                log.warning("저장된 코스 경사 형식이 맞지 않아 다음 단계로 넘어감: course_id=%s", int(row["id"]))
        if grade is None:
            grade = elevation_to_grade_profile(distance, _json(row.get("elevation_profile")))
            source = "COURSE_ELEVATION_PROFILE"
        if grade is None and self.elevation_source is not None:
            grade = elevation_to_grade_profile(distance, self.elevation_source.elevation_profile_for(int(course_id)))
            source = "ROUTE_ELEVATION_SOURCE"
        if grade is None:
            # 경사 정보 없음: 형식을 맞추기 위한 0% 자리표시. 개인 계획이 FREE_RUN_GRADE_POLICY로 처리한다.
            grade = (PlanGradeSegment(startDistanceM=0.0, endDistanceM=distance, gradePercent=0.0),)
            source = "MISSING"
        return CoursePlanSnapshot(course_id=int(row["id"]), distance_m=distance, grade_profile=grade,
                                  version=version, grade_source=source)


class DbUserPersonalizationLookup:
    """최신 ODE 개인화와 학습 심박 기준을 읽는다. 행이 없으면 신규 사용자(None)."""

    def __init__(self, db: Database):
        self.db = db

    def get_personalization(self, user_id: int) -> UserPersonalizationSnapshot:
        """개인화 행이 없으면 payload=None이며 학습 기준은 정책의 모집단 값으로 정한다."""
        params = {"user_id": int(user_id)}
        warnings: tuple[str, ...] = ()
        try:
            row = self.db.fetch_one(PERSONALIZATION_SQL, params)
        except DatabaseUnavailable as exc:
            if exc.sqlstate not in MISSING_RELATION_SQLSTATES:
                raise _unavailable() from None
            # 개인화 테이블·컬럼이 아직 없음(팀 ERD 전): 장애가 아니라 개인화 행 없음 → 신규 사용자 경로.
            row, warnings = None, ("PERSONALIZATION_TABLE_MISSING",)
        if row is None:
            return UserPersonalizationSnapshot(user_id=int(user_id), payload=None, warnings=warnings)
        payload = {
            "schemaVersion": row.get("schema_version"),
            "userId": int(row["user_id"]),
            "modelVersion": row.get("model_version"),
            "personalizationVersion": row.get("personalization_version"),
            "supportRunCount": row.get("support_run_count"),
            "summaryU": _json(row.get("summary_u_json")),
            "history8": _json(row.get("history8_json")),
            "p4": _json(row.get("p4_json")),
            "hr0SubBpm": _float(row.get("hr0_sub_bpm")),
            "hrRefBpm": _float(row.get("hr_ref_bpm")),
            "createdAt": _iso(row.get("created_at")),
        }
        return UserPersonalizationSnapshot(
            user_id=int(user_id), payload=payload,
            hr_danger_bpm=_float(row.get("hr_danger_bpm")),
            hr_sustain_bpm=_float(row.get("hr_sustain_bpm")),
            hr_threshold_run_count=row.get("hr_threshold_run_count"),
        )

    def get_speed_ref(self, user_id: int, *, cutoff: datetime) -> tuple[float | None, int, str | None]:
        """(v_ref, 러닝 수, 경고). 조회 실패(권한 없음·테이블 없음 포함)는 계획을 막지 않고 Train 기본값으로 둔다."""
        low, high = SPEED_REF_VALID_RANGE_MPS
        params = {"user_id": int(user_id), "cutoff": cutoff, "max_duration_sec": SPEED_REF_MAX_DURATION_SEC,
                  "min_speed_mps": low, "max_speed_mps": high, "limit": SPEED_REF_RECENT_RUNS}
        try:
            rows = self.db.fetch_all(SPEED_REF_SQL, params)
        except DatabaseUnavailable:
            return None, 0, SPEED_REF_UNAVAILABLE_WARNING
        value, count = speed_ref_from_runs(rows or [])
        return value, count, None


__all__ = ["MISSING_RELATION_SQLSTATES", "COURSE_SQL", "HR_THRESHOLD_COLUMNS", "HR_THRESHOLD_SQL",
           "PERSONALIZATION_SQL", "PERSONALIZATION_TABLE", "SPEED_REF_SQL", "SPEED_REF_UNAVAILABLE_WARNING",
           "GRU_PERSONALIZATION_COLUMNS", "GRU_PERSONALIZATION_SQL", "GRU_PERSONALIZATION_TABLE",
           "Database", "DatabaseUnavailable", "DbCourseLookup", "DbUserPersonalizationLookup",
           "PsycopgDatabase", "RouteElevationSource", "StoredCourseGradeSource", "default_db_factory"]
