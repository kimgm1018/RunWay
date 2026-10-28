"""실제 Docker·서버 접속 없이 배포/복구 결과를 검사한다.

실행: python -m unittest discover -s infra/backend/tests -v
Bash가 필요하다. Windows에서는 Git for Windows의 Bash를 사용한다.
Docker와 flock의 응답을 모의 처리하므로 실제 엔진·OS 파일 잠금 검증은 별도다.
"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASH = (
    str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe")
    if os.name == "nt"
    else shutil.which("bash")
)

# 허용한 명령만 응답한다. 실제 Docker 실행 파일로 전달하는 경로는 없다.
DOCKER_STUB = r'''#!/usr/bin/env bash
set -eu
printf '%s :: %s\n' "${BACKEND_IMAGE:-none}" "$*" >> "$MOCK_DIR/calls"
case "$1 $2" in
  'image inspect')
    if [[ ${MOCK_FAIL:-} == missing-image && ${!#} == runway-backend:test ]]; then exit 1; fi
    if [[ ${!#} == runway-backend:test ]]; then echo sha256:new; else echo sha256:old; fi ;;
  'image tag') exit 0 ;;
  'compose -f')
    shift 3
    case "$1" in
      config) [[ ${MOCK_FAIL:-} != bad-config ]] ;;
      ps)
        [[ ${MOCK_FAIL:-} != missing-container ]] || exit 0
        if [[ -f $MOCK_DIR/active ]]; then cat "$MOCK_DIR/active"; else echo old; fi ;;
      up)
        if [[ ${BACKEND_IMAGE:-} == sha256:old ]]; then
          echo old > "$MOCK_DIR/active"
          [[ ${MOCK_FAIL:-} != rollback-fails ]] || exit 1
        else
          echo new > "$MOCK_DIR/active"
          [[ ${MOCK_FAIL:-} != deploy-fails ]] || exit 1
        fi ;;
      *) exit 90 ;;
    esac ;;
  'inspect --format')
    case "$3" in
      '{{.Image}}') if [[ ${!#} == new ]]; then echo sha256:new; else echo sha256:old; fi ;;
      '{{.State.Running}}') [[ ${MOCK_FAIL:-} == stopped ]] && echo false || echo true ;;
      '{{.State.Restarting}}') [[ ${MOCK_FAIL:-} == restarting ]] && echo true || echo false ;;
      *) exit 91 ;;
    esac ;;
  'logs --tail')
    # 새 버전 검사 실패는 즉시 로그 조회 오류로 재현한다. 120초 대기는 하지 않는다.
    if [[ ${!#} == new && ( ${MOCK_FAIL:-} == check-fails || ${MOCK_FAIL:-} == rollback-fails ) ]]; then exit 1; fi
    if [[ ${MOCK_FAIL:-} == no-db-log ]]; then
      echo 'Started BackendApplication'
    else
      printf '%s\n' 'HikariPool-1 - Start completed.' 'Started BackendApplication'
    fi ;;
  'run --rm') [[ ${MOCK_FAIL:-} == http-500 ]] && printf 500 || printf 404 ;;
  *) exit 92 ;;
esac
'''


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="runway-cd-test-")
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name)
        self.bin = self.path / "bin"
        self.bin.mkdir()
        docker = self.bin / "docker"
        docker.write_text(DOCKER_STUB, encoding="utf-8", newline="\n")
        docker.chmod(0o755)
        lock = self.bin / "flock"
        lock.write_text('#!/usr/bin/env bash\n[[ ${MOCK_FAIL:-} != locked ]]\n',
                        encoding="utf-8", newline="\n")
        lock.chmod(0o755)
        self.compose = self.path / "compose.yaml"
        self.compose.write_text("services: {}\n", encoding="utf-8")
        self.env = os.environ.copy()
        self.env["PATH"] = str(self.bin) + os.pathsep + self.env["PATH"]
        # 실제 인증정보 대신 테스트용 임시 경로만 자식 프로세스에 전달한다.
        self.env["MOCK_DIR"] = self.posix(self.path)

    @staticmethod
    def posix(path):
        value = Path(path).as_posix()
        if os.name == "nt":
            return "/" + value[0].lower() + value[2:]
        return value

    def run_script(self, name, args, failure=""):
        self.env["MOCK_FAIL"] = failure
        return subprocess.run(
            [BASH, self.posix(ROOT / name), *args],
            env=self.env, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=15,
        )

    def deploy(self, failure=""):
        return self.run_script("deploy.sh", [
            "runway-backend:test", self.posix(self.compose),
            self.posix(self.path / "state"),
        ], failure)

    def calls(self):
        return (self.path / "calls").read_text(encoding="utf-8")

    def test_success_records_new_image_without_rollback(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.path / "active").read_text().strip(), "new")
        self.assertEqual((self.path / "state/current-image").read_text().strip(), "runway-backend:test")
        self.assertNotIn("sha256:old :: compose -f", self.calls())

    def test_failed_recreate_restores_previous_image_but_still_fails(self):
        result = self.deploy("deploy-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.path / "active").read_text().strip(), "old")
        self.assertIn("이전 이미지 복구 확인 완료", result.stderr)

    def test_failed_new_startup_restores_previous_image(self):
        result = self.deploy("check-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.path / "active").read_text().strip(), "old")
        self.assertEqual((self.path / "state/current-image").read_text().strip(), "sha256:old")

    def test_failed_rollback_is_not_reported_as_success(self):
        result = self.deploy("rollback-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("복구 확인도 실패", result.stderr)
        self.assertFalse((self.path / "state/current-image").exists())

    def test_preflight_failures_do_not_replace_running_service(self):
        for failure in ("missing-image", "bad-config", "missing-container"):
            with self.subTest(failure=failure):
                result = self.deploy(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.path / "active").exists())

    def test_wrong_image_is_rejected(self):
        result = self.run_script("check.sh", ["old", "sha256:unexpected", "curl:test", "1"])
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("run --rm", self.calls())

    def test_stopped_or_restarting_service_is_rejected(self):
        for failure in ("stopped", "restarting"):
            with self.subTest(failure=failure):
                result = self.run_script("check.sh", ["old", "sha256:old", "curl:test", "1"], failure)
                self.assertNotEqual(result.returncode, 0)

    def test_http_404_without_db_startup_is_not_enough(self):
        result = self.run_script("check.sh", ["old", "sha256:old", "curl:test", "1"], "no-db-log")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("run --rm", self.calls())

    def test_http_500_is_rejected(self):
        result = self.run_script("check.sh", ["old", "sha256:old", "curl:test", "1"], "http-500")
        self.assertNotEqual(result.returncode, 0)

    def test_lock_refusal_prevents_any_docker_operation(self):
        result = self.deploy("locked")
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.path / "calls").exists())
        self.assertFalse((self.path / "active").exists())


if __name__ == "__main__":
    unittest.main()
