"""개인화 테이블 미생성 시 계속 배포하고 기존 읽기 전용 검증을 유지한다."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_deploy import BASH

ROOT = Path(__file__).resolve().parents[1]


def posix(path):
    value = Path(path).as_posix()
    return "/" + value[0].lower() + value[2:] if os.name == "nt" else value


DOCKER = r'''#!/usr/bin/env bash
set -eu
if [[ $1 == ps ]]; then echo db; exit; fi
query=$(cat)
printf '%s\n' "$query" >> "$MOCK_DIR/sql"
if [[ $query == *running_sessions* ]]; then echo "${RUNNING_SESSIONS_RESULT:-t}"
elif [[ $query == *user_profiles* ]]; then echo "${USER_PROFILES_RESULT:-t}"
elif [[ $query == *running_metric_samples* ]]; then echo "${BPM_RESULT:-t}"
elif [[ $query == *has_database_privilege* ]]; then echo "${GRANT_RESULT:-t}"
elif [[ $query == *GRANT* ]]; then echo "${GRANT_RESULT:-t}"; else echo "${READY_RESULT:-t}"; fi
'''


@unittest.skipUnless(BASH and Path(BASH).exists(), "Bash 필요")
class ReadonlyGrantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        executable = self.root / "docker"
        executable.write_text(DOCKER, encoding="utf-8", newline="\n")
        executable.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ["PATH"],
                        MOCK_DIR=posix(self.root))

    def run_grant(self):
        return subprocess.run([BASH, posix(ROOT / "grant-readonly.sh"), "1"],
                              env=self.env, capture_output=True, text=True, encoding="utf-8", timeout=15)

    def test_missing_personalization_warns_and_continues(self):
        self.env["READY_RESULT"] = "f"
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("경고", result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertNotIn("user_hr_personalization TO runway_ai", sql)
        # running_sessions(402)·user_profiles(403)는 V1부터 있으므로 V10 대기와 관계없이 먼저 부여한다.
        self.assertIn("GRANT SELECT ON public.running_sessions TO runway_ai", sql)
        self.assertIn("GRANT SELECT ON public.user_profiles TO runway_ai", sql)

    def test_running_sessions_is_granted_before_waiting_and_checked_read_only(self):
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        for table in ("running_sessions", "user_profiles"):
            self.assertLess(sql.index(f"public.{table} TO runway_ai"), sql.index("to_regclass"))
            self.assertIn(f"has_table_privilege('runway_ai', 'public.{table}', 'SELECT')", sql)
            self.assertIn(f"NOT has_table_privilege('runway_ai', 'public.{table}', 'INSERT,UPDATE,DELETE,TRUNCATE')",
                          sql)

    def test_running_sessions_privilege_failure_stops_deployment(self):
        self.env["RUNNING_SESSIONS_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("to_regclass", (self.root / "sql").read_text())

    def test_bpm_record_columns_are_granted_before_waiting_without_heart_rate(self):
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT (running_session_id, measured_at, elapsed_duration, speed, cadence)", sql)
        self.assertIn("GRANT SELECT (session_id, action, target_bpm, result, applied_at)", sql)
        self.assertNotIn("GRANT SELECT ON public.running_metric_samples", sql)       # 테이블 전체는 주지 않는다
        self.assertIn("NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'heart_rate', 'SELECT')",
                      sql)
        self.assertLess(sql.index("public.running_metric_samples TO runway_ai"), sql.index("to_regclass"))

    def test_bpm_record_privilege_failure_stops_deployment(self):
        self.env["BPM_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("to_regclass", (self.root / "sql").read_text())

    def test_user_profiles_privilege_failure_stops_deployment(self):
        self.env["USER_PROFILES_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("to_regclass", (self.root / "sql").read_text())

    def test_v10_ready_grants_only_hr_table_and_checks_write_denial(self):
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT ON public.user_hr_personalization TO runway_ai", sql)
        self.assertNotIn("flyway_schema_history", sql)
        self.assertIn("INSERT,UPDATE,DELETE,TRUNCATE", sql)
        self.assertNotIn("user_gru_personalization", sql)
        self.assertNotIn("ALL TABLES", sql)

    def test_missing_table_does_not_bypass_base_privilege_failure(self):
        self.env["READY_RESULT"] = "f"
        self.env["GRANT_RESULT"] = "f"
        self.assertNotEqual(self.run_grant().returncode, 0)

    def test_invalid_table_lookup_stops_deployment(self):
        self.env["READY_RESULT"] = "invalid"
        self.assertNotEqual(self.run_grant().returncode, 0)

    def test_excess_privilege_stops_deployment(self):
        self.env["GRANT_RESULT"] = "f"
        self.assertNotEqual(self.run_grant().returncode, 0)
