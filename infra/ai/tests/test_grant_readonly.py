"""V10 전 권한 부여 차단과 최소 권한 범위를 모의 Docker로 확인한다."""
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
if [[ $query == *GRANT* ]]; then echo "${GRANT_RESULT:-t}"; else echo "${READY_RESULT:-t}"; fi
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

    def test_v10_missing_does_not_grant(self):
        self.env["READY_RESULT"] = "f"
        result = self.run_grant()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("GRANT SELECT", (self.root / "sql").read_text())

    def test_v10_ready_grants_only_hr_table_and_checks_write_denial(self):
        result = self.run_grant()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.root / "sql").read_text()
        self.assertIn("GRANT SELECT ON public.user_hr_personalization TO runway_ai", sql)
        self.assertIn("version = '10' AND success", sql)
        self.assertIn("INSERT,UPDATE,DELETE,TRUNCATE", sql)
        self.assertNotIn("user_gru_personalization", sql)
        self.assertNotIn("ALL TABLES", sql)

    def test_excess_privilege_stops_deployment(self):
        self.env["GRANT_RESULT"] = "f"
        self.assertNotEqual(self.run_grant().returncode, 0)
