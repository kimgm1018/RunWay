from decimal import Decimal

from app.db_lookup import DatabaseUnavailable
from app.hr_threshold_lookup import CachedDbHrThresholdLookup, HR_THRESHOLD_SQL


class FakeDb:
    def __init__(self, row=None, error=None):
        self.row = row
        self.error = error
        self.calls = []

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self.calls.append((sql, params, timeout_ms))
        if self.error is not None:
            raise self.error
        return self.row


def _row(**overrides):
    row = {"hr_danger_bpm": Decimal("195.00"), "hr_sustain_bpm": Decimal("180.00"),
           "hr_threshold_run_count": 2}
    row.update(overrides)
    return row


def test_threshold_lookup_uses_latest_hr_columns_and_300ms_timeout():
    db = FakeDb(_row())
    lookup = CachedDbHrThresholdLookup(db)

    result = lookup.get_for_user(73)
    cached = lookup.get_for_user(73)

    assert result == cached
    assert (result.hr_danger_bpm, result.hr_sustain_bpm, result.hr_threshold_run_count) == (195.0, 180.0, 2)
    assert len(db.calls) == 1
    sql, params, timeout_ms = db.calls[0]
    assert params == {"user_id": 73} and timeout_ms == 300
    assert "ORDER BY personalization_version DESC" in sql
    assert "birth_date" not in sql and "daily_health_metrics" not in sql
    assert HR_THRESHOLD_SQL == sql


def test_missing_threshold_row_is_cached_for_sixty_seconds():
    now = [0.0]
    db = FakeDb(None)
    lookup = CachedDbHrThresholdLookup(db, monotonic=lambda: now[0])

    lookup.get_for_user(73)
    now[0] = 59.0
    lookup.get_for_user(73)
    now[0] = 61.0
    lookup.get_for_user(73)

    assert len(db.calls) == 2


def test_personal_threshold_result_is_cached_for_three_hundred_seconds():
    now = [0.0]
    db = FakeDb(_row())
    lookup = CachedDbHrThresholdLookup(db, monotonic=lambda: now[0])

    lookup.get_for_user(73)
    now[0] = 299.0
    lookup.get_for_user(73)
    now[0] = 301.0
    lookup.get_for_user(73)

    assert len(db.calls) == 2


def test_database_error_becomes_population_fallback_warning():
    db = FakeDb(error=DatabaseUnavailable("QueryCanceled"))
    result = CachedDbHrThresholdLookup(db).get_for_user(73)

    assert result.hr_danger_bpm is None and result.hr_sustain_bpm is None
    assert result.hr_threshold_run_count == 0
    assert result.warning == "HR_THRESHOLD_LOOKUP_UNAVAILABLE"
