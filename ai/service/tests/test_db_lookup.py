"""AI 서비스 DB 조회 어댑터 테스트. 실제 DB 없이 가짜 연결로 SQL 바인딩·변환·오류 경로를 본다."""
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.db_lookup import (
    COURSE_SQL, PERSONALIZATION_SQL, PERSONALIZATION_TABLE,
    DatabaseUnavailable, DbCourseLookup, DbUserPersonalizationLookup, PsycopgDatabase,
)
from app.inference import ApiError
from app.main import create_app
from app.ode_schemas import PlanGradeSegment
from app.personal_plan import CoursePlanSnapshot, resolve_selected_goal
from demo_fakes import FakeModel5, FakePolicy
from test_personal_plan_ode import RecordingOdeRuntime

UPDATED = datetime(2026, 11, 2, 3, 4, 5, tzinfo=timezone.utc)


class FakeDb:
    def __init__(self, rows=None, fail=False):
        self.rows = rows or {}
        self.fail = fail
        self.calls = []

    def _answer(self, sql, params):
        self.calls.append((sql, params))
        if self.fail:
            raise DatabaseUnavailable("QueryCanceled")
        for key, value in self.rows.items():
            if sql == key:
                return value
        return None

    def fetch_one(self, sql, params):
        value = self._answer(sql, params)
        return value[0] if isinstance(value, list) and value else (value if not isinstance(value, list) else None)

    def fetch_all(self, sql, params):
        value = self._answer(sql, params)
        return value if isinstance(value, list) else ([] if value is None else [value])


def course_row(**overrides):
    row = {"id": 297, "distance": Decimal("1000.00"), "elevation_profile": [20.0] * 10,
           "status": "ACTIVE", "updated_at": UPDATED}
    row.update(overrides)
    return row


def personalization_row(**overrides):
    row = {"user_id": 73, "personalization_version": 3, "schema_version": "runway.ode.personalization.v1",
           "model_version": "ode-fixture-v1", "support_run_count": 4,
           "summary_u_json": {"prev_start_hr": 120.0}, "history8_json": [[0.0, 0.1, 3.0, 0.0, 0.0]],
           "p4_json": [0.1, -0.1, 0.05, 0.0], "hr0_sub_bpm": Decimal("120.00"),
           "hr_ref_bpm": Decimal("155.00"), "hr_danger_bpm": None, "hr_sustain_bpm": None,
           "hr_threshold_run_count": None, "created_at": UPDATED}
    row.update(overrides)
    return row


# --- 코스 -----------------------------------------------------------------

def test_course_query_binds_the_id_as_a_parameter_and_converts_elevation():
    db = FakeDb({COURSE_SQL: course_row()})
    course = DbCourseLookup(db).get_course(297)

    sql, params = db.calls[0]
    assert params == {"course_id": 297} and "%(course_id)s" in sql and "297" not in sql
    assert course.course_id == 297 and course.distance_m == 1000.0
    assert course.grade_source == "COURSE_ELEVATION_PROFILE"
    assert course.version == "courses:297:2026-11-02T03:04:05+00:00"
    assert len(course.grade_profile) == 10


def test_jsonb_text_is_also_accepted():
    db = FakeDb({COURSE_SQL: course_row(elevation_profile=json.dumps([{"distanceM": 0, "elevationM": 1},
                                                                        {"distanceM": 1000, "elevationM": 11}]))})
    course = DbCourseLookup(db).get_course(297)

    assert course.grade_source == "COURSE_ELEVATION_PROFILE"


@pytest.mark.parametrize("profile", [None, [], "not json", [1.0]])
def test_missing_or_invalid_elevation_marks_grade_missing_with_a_flat_placeholder(profile):
    course = DbCourseLookup(FakeDb({COURSE_SQL: course_row(elevation_profile=profile)})).get_course(297)

    assert course.grade_source == "MISSING"
    assert [(s.start_distance_m, s.end_distance_m, s.grade_percent) for s in course.grade_profile] \
        == [(0.0, 1000.0, 0.0)]


@pytest.mark.parametrize("row", [None, course_row(status="BLOCKED"), course_row(status="MERGED")])
def test_absent_or_inactive_course_is_not_found(row):
    assert DbCourseLookup(FakeDb({COURSE_SQL: row})).get_course(297) is None


def test_course_db_failure_is_a_503_without_details():
    with pytest.raises(ApiError) as error:
        DbCourseLookup(FakeDb(fail=True)).get_course(297)

    assert error.value.status == 503 and error.value.code == "AI_DB_UNAVAILABLE"


class FakeElevationSource:
    def elevation_profile_for(self, course_id):
        return [0.0, 10.0]


def test_optional_route_elevation_source_is_used_only_when_the_column_is_missing():
    course = DbCourseLookup(FakeDb({COURSE_SQL: course_row(elevation_profile=None)}),
                            elevation_source=FakeElevationSource()).get_course(297)

    assert course.grade_source == "ROUTE_ELEVATION_SOURCE"


# --- 백엔드가 저장한 코스 경사(StoredCourseGradeSource) ----------------------------

def segments(distance, length, grade=1.0):
    bounds = list(range(0, int(distance), int(length))) + [int(distance)]
    return [PlanGradeSegment(startDistanceM=float(a), endDistanceM=float(b), gradePercent=grade)
            for a, b in zip(bounds, bounds[1:])]


class FakeStoredGrade:
    def __init__(self, value):
        self.value = value
        self.rows = []

    def grade_profile_for(self, course_row):
        self.rows.append(course_row)
        return self.value


@pytest.mark.parametrize("length", [1000, 100])
def test_stored_course_grade_is_read_first_for_any_segment_length(length):
    stored = FakeStoredGrade(segments(2000, length, grade=2.5))
    course = DbCourseLookup(FakeDb({COURSE_SQL: course_row(distance=Decimal("2000.00"))}),
                            stored_grade_source=stored,
                            elevation_source=FakeElevationSource()).get_course(297)

    assert course.grade_source == "COURSE_STORED_GRADE"
    assert len(course.grade_profile) == 2000 // length
    assert all(s.grade_percent == 2.5 for s in course.grade_profile)
    assert stored.rows[0]["id"] == 297
    # 기존 개인 계획 검사(마지막 끝 = 코스 거리)를 그대로 통과한다.
    assert resolve_selected_goal(None, course).distance_m == 2000


@pytest.mark.parametrize("bad", [
    None,
    [],
    segments(990, 100),                                   # 마지막 끝 거리 불일치
    segments(1000, 100)[:3] + segments(1000, 100)[4:],    # 중간 구간 빠짐
    [{"startDistanceM": 0, "endDistanceM": 1000, "gradePercent": 1.0}],  # PlanGradeSegment가 아님
])
def test_invalid_stored_grade_falls_back_to_the_elevation_profile(bad):
    course = DbCourseLookup(FakeDb({COURSE_SQL: course_row()}),
                            stored_grade_source=FakeStoredGrade(bad)).get_course(297)

    assert course.grade_source == "COURSE_ELEVATION_PROFILE"


def test_stored_grade_over_450_segments_falls_back_to_the_elevation_profile():
    course = DbCourseLookup(FakeDb({COURSE_SQL: course_row(distance=Decimal("45100.00"))}),
                            stored_grade_source=FakeStoredGrade(segments(45100, 100))).get_course(297)

    assert course.grade_source == "COURSE_ELEVATION_PROFILE"


def test_stored_grade_accepts_422_segments_for_a_marathon_course():
    course = DbCourseLookup(FakeDb({COURSE_SQL: course_row(distance=Decimal("42195.00"))}),
                            stored_grade_source=FakeStoredGrade(segments(42195, 100))).get_course(297)

    assert course.grade_source == "COURSE_STORED_GRADE" and len(course.grade_profile) == 422


def test_grade_lookup_order_is_stored_then_elevation_then_route_then_missing():
    def lookup(stored, profile, route):
        return DbCourseLookup(FakeDb({COURSE_SQL: course_row(elevation_profile=profile)}),
                              stored_grade_source=FakeStoredGrade(stored),
                              elevation_source=FakeElevationSource() if route else None).get_course(297)

    assert lookup(segments(1000, 1000), [20.0] * 10, True).grade_source == "COURSE_STORED_GRADE"
    assert lookup(None, [20.0] * 10, True).grade_source == "COURSE_ELEVATION_PROFILE"
    assert lookup(None, None, True).grade_source == "ROUTE_ELEVATION_SOURCE"
    missing = lookup(None, None, False)
    assert missing.grade_source == "MISSING"
    assert [(s.start_distance_m, s.end_distance_m, s.grade_percent) for s in missing.grade_profile]         == [(0.0, 1000.0, 0.0)]


def test_stored_grade_source_is_off_by_default():
    assert DbCourseLookup(FakeDb()).stored_grade_source is None


def test_stored_grade_db_failure_is_a_503_without_details():
    class FailingStoredGrade:
        def grade_profile_for(self, course_row):
            raise DatabaseUnavailable("QueryCanceled")

    with pytest.raises(ApiError) as error:
        DbCourseLookup(FakeDb({COURSE_SQL: course_row()}),
                       stored_grade_source=FailingStoredGrade()).get_course(297)

    assert error.value.status == 503 and error.value.code == "AI_DB_UNAVAILABLE"


def test_course_snapshot_accepts_only_known_grade_sources():
    grade = tuple(segments(1000, 1000))
    for source in ("COURSE_STORED_GRADE", "COURSE_ELEVATION_PROFILE", "ROUTE_ELEVATION_SOURCE", "MISSING"):
        CoursePlanSnapshot(course_id=1, distance_m=1000.0, grade_profile=grade, version="v", grade_source=source)
    with pytest.raises(ValueError):
        CoursePlanSnapshot(course_id=1, distance_m=1000.0, grade_profile=grade, version="v", grade_source="GUESS")


# --- 개인화 ----------------------------------------------------------------

def test_personalization_query_uses_the_configured_table_and_bound_user_id():
    db = FakeDb({PERSONALIZATION_SQL: personalization_row(hr_danger_bpm=Decimal("195.00"),
                                                           hr_sustain_bpm=Decimal("180.00"),
                                                           hr_threshold_run_count=2)})
    snapshot = DbUserPersonalizationLookup(db).get_personalization(73)

    assert PERSONALIZATION_TABLE in PERSONALIZATION_SQL
    assert all(params == {"user_id": 73} for _, params in db.calls)
    assert all("73" not in sql for sql, _ in db.calls)
    payload = snapshot.payload
    assert payload["userId"] == 73 and payload["modelVersion"] == "ode-fixture-v1"
    assert payload["p4"] == [0.1, -0.1, 0.05, 0.0] and payload["hr0SubBpm"] == 120.0
    assert payload["personalizationVersion"] == 3 and payload["createdAt"] == "2026-11-02T03:04:05+00:00"
    assert snapshot.hr_danger_bpm == 195.0 and snapshot.hr_sustain_bpm == 180.0
    assert snapshot.hr_threshold_run_count == 2
    assert len(db.calls) == 1
    assert "birth_date" not in db.calls[0][0] and "daily_health_metrics" not in db.calls[0][0]


def test_user_without_personalization_row_is_a_new_user():
    # 신규 사용자는 개인화 행만 읽고, 평균 기준 HR은 정책의 모집단 값으로 쓴다.
    db = FakeDb({PERSONALIZATION_SQL: None})
    snapshot = DbUserPersonalizationLookup(db).get_personalization(73)

    assert snapshot.payload is None and snapshot.hr_danger_bpm is None and snapshot.warnings == ()
    assert [sql for sql, _ in db.calls] == [PERSONALIZATION_SQL]


def test_personalization_db_failure_is_a_503():
    with pytest.raises(ApiError) as error:
        DbUserPersonalizationLookup(FakeDb(fail=True)).get_personalization(73)

    assert error.value.status == 503 and error.value.code == "AI_DB_UNAVAILABLE"


# --- 연결 래퍼 ----------------------------------------------------------------

class ExplodingPool:
    def __init__(self):
        self.opened = 0

    def open(self, wait=False):
        self.opened += 1

    def connection(self, timeout=None):
        raise RuntimeError("connection to postgresql://reader:SECRET@db:5432/runway failed")


def test_driver_errors_become_database_unavailable_without_leaking_the_url(caplog):
    database = PsycopgDatabase("postgresql://reader:SECRET@db:5432/runway", pool=ExplodingPool())
    caplog.set_level(logging.DEBUG)

    with pytest.raises(DatabaseUnavailable) as error:
        database.fetch_one(COURSE_SQL, {"course_id": 297})

    assert "SECRET" not in str(error.value) and error.value.__cause__ is None
    assert "SECRET" not in caplog.text and "postgresql://" not in caplog.text


def test_default_pool_options_set_a_two_second_statement_timeout_and_read_only():
    kwargs = PsycopgDatabase.connect_kwargs(statement_timeout_ms=2000)

    assert "statement_timeout=2000" in kwargs["options"]
    assert "default_transaction_read_only=on" in kwargs["options"]
    assert kwargs["connect_timeout"] == 2


# --- 서비스 연결 ----------------------------------------------------------------

def _app(monkeypatch, db, url="postgresql://configured"):
    if url is None:
        monkeypatch.delenv("AI_DB_URL", raising=False)
    else:
        monkeypatch.setenv("AI_DB_URL", url)
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    return create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: RecordingOdeRuntime(),
                      db_factory=lambda url: db)


def test_ai_db_url_wires_course_and_personalization_lookups_and_returns_a_plan(monkeypatch):
    db = FakeDb({COURSE_SQL: course_row(distance=Decimal("2000.00"), elevation_profile=[10.0, 10.0, 60.0]),
                 PERSONALIZATION_SQL: personalization_row()})
    with TestClient(_app(monkeypatch, db)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 200, response.json()
    assert response.json()["personalized"] is True
    assert response.json()["courseVersion"].startswith("courses:297:")


def test_unknown_course_in_db_is_404(monkeypatch):
    with TestClient(_app(monkeypatch, FakeDb({COURSE_SQL: None}))) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 999})

    assert response.status_code == 404 and response.json()["code"] == "COURSE_NOT_FOUND"


def test_db_timeout_is_503(monkeypatch):
    with TestClient(_app(monkeypatch, FakeDb(fail=True))) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503 and response.json()["code"] == "AI_DB_UNAVAILABLE"


def test_new_user_without_population_mean_is_not_ready(monkeypatch):
    db = FakeDb({COURSE_SQL: course_row(), PERSONALIZATION_SQL: None})
    with TestClient(_app(monkeypatch, db)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503 and response.json()["code"] == "PERSONAL_PLAN_NOT_READY"


def test_without_ai_db_url_the_endpoint_stays_not_ready(monkeypatch):
    with TestClient(_app(monkeypatch, FakeDb(), url=None)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503 and response.json()["code"] == "PERSONAL_PLAN_NOT_READY"


def test_course_without_elevation_follows_the_free_run_grade_policy(monkeypatch):
    db = FakeDb({COURSE_SQL: course_row(distance=Decimal("2000.00"), elevation_profile=None),
                 PERSONALIZATION_SQL: personalization_row()})
    with TestClient(_app(monkeypatch, db)) as client:
        planned = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "reject")
    with TestClient(_app(monkeypatch, db)) as client:
        rejected = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert planned.status_code == 200
    assert "COURSE_GRADE_PROFILE_MISSING" in planned.json()["warnings"]
    assert "FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL" in planned.json()["warnings"]
    assert rejected.status_code == 422 and rejected.json()["code"] == "COURSE_GRADE_UNAVAILABLE"


# --- 개인화 테이블 없음(팀 ERD 전) ------------------------------------------------

class SqlStateError(Exception):
    """psycopg 예외 흉내: 드라이버 없이 sqlstate 속성만 가진다."""

    def __init__(self, sqlstate):
        super().__init__(f"relation failed postgresql://reader:SECRET@db sqlstate={sqlstate}")
        self.sqlstate = sqlstate


class RaisingCursorPool:
    def __init__(self, exc):
        self.exc = exc

    def open(self, wait=False):
        pass

    def connection(self, timeout=None):
        pool = self

        class Conn:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def cursor(self):
                class Cursor:
                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        return False

                    def execute(self, sql, params):
                        raise pool.exc
                return Cursor()
        return Conn()


@pytest.mark.parametrize("sqlstate", ["42P01", "42703"])
def test_driver_sqlstate_is_kept_on_database_unavailable(sqlstate):
    database = PsycopgDatabase("postgresql://x", pool=RaisingCursorPool(SqlStateError(sqlstate)))
    with pytest.raises(DatabaseUnavailable) as error:
        database.fetch_one(PERSONALIZATION_SQL, {"user_id": 73})

    assert error.value.sqlstate == sqlstate and "SECRET" not in str(error.value)


def test_errors_without_sqlstate_have_none():
    database = PsycopgDatabase("postgresql://x", pool=ExplodingPool())
    with pytest.raises(DatabaseUnavailable) as error:
        database.fetch_one(PERSONALIZATION_SQL, {"user_id": 73})

    assert error.value.sqlstate is None


class SqlFailDb(FakeDb):
    def __init__(self, rows=None, fail_sql=None, sqlstate=None):
        super().__init__(rows)
        self.fail_sql, self.sqlstate = fail_sql, sqlstate

    def _answer(self, sql, params):
        if sql == self.fail_sql:
            self.calls.append((sql, params))
            raise DatabaseUnavailable("UndefinedTable", sqlstate=self.sqlstate)
        return super()._answer(sql, params)


@pytest.mark.parametrize("sqlstate", ["42P01", "42703"])
def test_missing_personalization_table_is_treated_as_no_row_with_a_warning(sqlstate):
    snapshot = DbUserPersonalizationLookup(
        SqlFailDb(fail_sql=PERSONALIZATION_SQL, sqlstate=sqlstate)).get_personalization(73)

    assert snapshot is not None and snapshot.payload is None
    assert snapshot.warnings == ("PERSONALIZATION_TABLE_MISSING",)


@pytest.mark.parametrize("sqlstate", [None, "57014", "08006"])
def test_real_db_failures_on_personalization_stay_503(sqlstate):
    with pytest.raises(ApiError) as error:
        DbUserPersonalizationLookup(
            SqlFailDb(fail_sql=PERSONALIZATION_SQL, sqlstate=sqlstate)).get_personalization(73)

    assert error.value.status == 503 and error.value.code == "AI_DB_UNAVAILABLE"


def test_missing_course_table_stays_503():
    with pytest.raises(ApiError) as course_error:
        DbCourseLookup(SqlFailDb(fail_sql=COURSE_SQL, sqlstate="42P01")).get_course(297)

    assert course_error.value.code == "AI_DB_UNAVAILABLE"


def test_missing_personalization_table_goes_to_the_new_user_path_with_the_warning(monkeypatch):
    db = SqlFailDb({COURSE_SQL: course_row(distance=Decimal("2000.00"))},
                   fail_sql=PERSONALIZATION_SQL, sqlstate="42P01")
    with TestClient(_app(monkeypatch, db)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503 and response.json()["code"] == "PERSONAL_PLAN_NOT_READY"
    fields = response.json()["details"]["fields"]
    assert {"name": "readiness", "reason": "POPULATION_MEAN_MODEL_NOT_CONFIGURED"} in fields
    assert {"name": "warnings", "reason": "PERSONALIZATION_TABLE_MISSING"} in fields
    assert "PERSONALIZATION_TABLE_MISSING" in response.headers.get("X-RunWay-Warnings", "")


def test_connection_failure_on_personalization_is_still_ai_db_unavailable(monkeypatch):
    db = SqlFailDb({COURSE_SQL: course_row(distance=Decimal("2000.00"))},
                   fail_sql=PERSONALIZATION_SQL, sqlstate=None)
    with TestClient(_app(monkeypatch, db)) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503 and response.json()["code"] == "AI_DB_UNAVAILABLE"
