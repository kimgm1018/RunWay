"""ERD 제안 SQL과 AI DB 조회 코드가 같은 테이블·컬럼 이름을 쓰는지 확인한다."""
import re
from pathlib import Path

import pytest

from app import db_lookup

SQL_PATH = Path(__file__).resolve().parents[3] / "docs" / "design" / "db" / "proposals" / "ai_personalization.sql"


def table_columns(sql: str, table: str) -> set[str]:
    match = re.search(rf'CREATE TABLE "{table}" \((.*?)\n\);', sql, re.S)
    assert match, f"{table} 정의가 제안 SQL에 없다"
    return set(re.findall(r'^\s+"([a-z_0-9]+)"\s+[A-Z]', match.group(1), re.M))


@pytest.fixture(scope="module")
def sql():
    if not SQL_PATH.is_file():
        pytest.skip("ERD 제안 SQL이 없는 배치(서비스 단독 복사본)")
    return SQL_PATH.read_text(encoding="utf-8")


@pytest.mark.parametrize("table, columns", [
    (db_lookup.PERSONALIZATION_TABLE, db_lookup.PERSONALIZATION_COLUMNS),
    (db_lookup.PERSONALIZATION_TABLE, db_lookup.HR_THRESHOLD_COLUMNS),
    (db_lookup.GRU_PERSONALIZATION_TABLE, db_lookup.GRU_PERSONALIZATION_COLUMNS),
])
def test_lookup_columns_exist_in_proposal(sql, table, columns):
    assert set(columns) <= table_columns(sql, table)


def test_threshold_run_count_check_matches_blend_table(sql):
    assert re.search(r'"hr_threshold_run_count"\s+BETWEEN\s+0\s+AND\s+20', sql)
