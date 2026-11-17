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
elif [[ $query == *daily_readiness* ]]; then echo "${READINESS_RESULT:-t}"
elif [[ $query == *is_hr_measured* ]]; then echo "${LIVE_RESULT:-t}"
elif [[ $query == *running_metric_samples* ]]; then echo "${BPM_RESULT:-t}"
elif [[ $query == *running_route_points* ]]; then echo "${ROUTE_RESULT:-t}"
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

    def test_daily_readiness_is_granted_read_only_before_waiting(self):
        # 676 준비도 민감도: daily_readiness는 V1부터 있으므로 V10 대기 전에 읽기만 준다.
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT ON public.daily_readiness TO runway_ai", sql)
        self.assertIn("NOT has_table_privilege('runway_ai', 'public.daily_readiness', 'INSERT,UPDATE,DELETE,TRUNCATE')",
                      sql)
        self.assertLess(sql.index("public.daily_readiness TO runway_ai"), sql.index("to_regclass"))

    def test_daily_readiness_privilege_failure_stops_deployment(self):
        self.env["READINESS_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("to_regclass", (self.root / "sql").read_text())

    def test_bpm_record_columns_are_granted_before_waiting(self):
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT (running_session_id, measured_at, elapsed_duration, speed, cadence)", sql)
        self.assertIn("GRANT SELECT (session_id, action, target_bpm, result, applied_at)", sql)
        self.assertNotIn("GRANT SELECT ON public.running_metric_samples", sql)       # 테이블 전체는 주지 않는다
        self.assertIn("NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'grade', 'SELECT')", sql)
        self.assertLess(sql.index("public.running_metric_samples TO runway_ai"), sql.index("to_regclass"))

    def test_live_metric_columns_are_granted_only_heart_rate_flag_and_distance(self):
        # 912 시연 실시간 측정값(2026-11-17 승인 방식 A): 심박·측정 여부·누적 거리 세 칸만 더 준다.
        # 이전 기대값(heart_rate 미부여 검사)은 이 결정으로 바뀌었다. 경사·진행 거리·기기·ID·쓰기는 계속 주지 않는다.
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT (heart_rate, is_hr_measured, total_distance)\n  ON public.running_metric_samples TO runway_ai",
                      sql)
        for column in ("heart_rate", "is_hr_measured", "total_distance"):
            self.assertIn(f"has_column_privilege('runway_ai', 'public.running_metric_samples', '{column}', 'SELECT')\n", sql)
        for column in ("grade", "route_progress", "device_id", "id"):
            self.assertIn(f"NOT has_column_privilege('runway_ai', 'public.running_metric_samples', '{column}', 'SELECT')", sql)
        self.assertIn("NOT has_table_privilege('runway_ai', 'public.running_metric_samples', 'INSERT,UPDATE,DELETE,TRUNCATE')",
                      sql)
        self.assertNotIn("NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'heart_rate', 'SELECT')", sql)
        self.assertLess(sql.index("(heart_rate, is_hr_measured, total_distance)"), sql.index("to_regclass"))

    def test_live_metric_privilege_failure_stops_deployment(self):
        self.env["LIVE_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("시연 실시간 측정값 읽기 권한 확인 실패", result.stderr)
        self.assertNotIn("to_regclass", (self.root / "sql").read_text())

    def test_bpm_record_privilege_failure_stops_deployment(self):
        self.env["BPM_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("to_regclass", (self.root / "sql").read_text())

    def test_route_point_columns_are_granted_without_accuracy_or_altitude(self):
        # 722 시연 지도: 세션·시각·위치 세 칸만, 정확도·고도·쓰기는 주지 않는다.
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT (running_session_id, measured_at, position)\n  ON public.running_route_points TO runway_ai", sql)
        self.assertNotIn("GRANT SELECT ON public.running_route_points", sql)
        for column in ("accuracy", "altitude"):
            self.assertIn(f"NOT has_column_privilege('runway_ai', 'public.running_route_points', '{column}', 'SELECT')", sql)
        self.assertIn("NOT has_table_privilege('runway_ai', 'public.running_route_points', 'INSERT,UPDATE,DELETE,TRUNCATE')",
                      sql)
        self.assertLess(sql.index("public.running_route_points TO runway_ai"), sql.index("to_regclass"))

    def test_route_point_privilege_failure_stops_deployment(self):
        self.env["ROUTE_RESULT"] = "f"
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
