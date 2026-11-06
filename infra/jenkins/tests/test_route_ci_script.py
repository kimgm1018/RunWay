"""Docker를 흉내 내 검사 실패·보고서 복사·정리 범위를 실제 Shell에서 검증한다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
BASH = shutil.which("bash")
if os.name == "nt":
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    BASH = str(git_bash) if git_bash.is_file() else None


@unittest.skipUnless(BASH, "Bash가 필요합니다")
class RouteScriptTest(unittest.TestCase):
    def run_script(self, mode="all", failure="", tag="verify-507"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # 실제 저장소 artifacts를 덮어쓰지 않는 최소 작업 폴더다.
            scripts = root / "infra" / "jenkins"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "infra/jenkins/check-route.sh", scripts / "check-route.sh")
            binary = root / "bin"
            binary.mkdir()
            docker = binary / "docker"
            docker.write_text("""#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
if [ "$1" = "$FAIL_COMMAND" ]; then exit 7; fi
if [ "$1" = cp ]; then
  mkdir -p "$(dirname "$3")"
  printf '<testsuite tests="1" failures="0"/>' > "$3"
fi
""", encoding="utf-8", newline="\n")
            docker.chmod(0o755)
            env = os.environ.copy()
            env.update(PATH=str(binary) + os.pathsep + env["PATH"], ROUTE_CI_TAG=tag,
                       CALL_LOG=str(root / "calls.txt"), FAIL_COMMAND=failure)
            result = subprocess.run([BASH, str(scripts / "check-route.sh"), "--stage", mode],
                                    env=env, capture_output=True, text=True, encoding="utf-8")
            log = root / "calls.txt"
            return result.returncode, log.read_text() if log.exists() else "", (root / "artifacts/route/pytest.xml").exists()

    def test_success_copies_report_and_removes_only_own_resources(self):
        code, calls, report = self.run_script()
        self.assertEqual(code, 0, calls)
        self.assertTrue(report)
        self.assertIn("--network none", calls)
        self.assertNotIn("--mount", calls)
        self.assertIn("image rm runway-route-ci:verify-507-test", calls)
        self.assertNotIn("prune", calls)

    def test_test_failure_keeps_exit_code_and_report_and_cleans(self):
        code, calls, report = self.run_script(failure="start")
        self.assertEqual(code, 7)
        self.assertTrue(report)
        self.assertIn("rm -f runway-route-ci-verify-507", calls)
        self.assertIn("image rm runway-route-ci:verify-507-test", calls)

    def test_build_failure_skips_test_and_cleans(self):
        code, calls, report = self.run_script(failure="build")
        self.assertEqual(code, 7)
        self.assertFalse(report)
        self.assertNotIn("create --name", calls)
        self.assertIn("image rm runway-route-ci:verify-507-test", calls)

    def test_invalid_tag_never_calls_docker(self):
        for tag in ["../production", "-x", "UPPER", "x" * 97]:
            code, calls, report = self.run_script(tag=tag)
            self.assertNotEqual(code, 0)
            self.assertEqual(calls, "")


if __name__ == "__main__":
    unittest.main()
