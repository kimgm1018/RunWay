"""Docker를 모의 처리해 AI 이미지·모델 복구와 실패 전파를 검사한다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASH = str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe") if os.name == "nt" else shutil.which("bash")

DOCKER = r"""#!/usr/bin/env bash
set -eu
printf '%s|%s|%s|%s|%s\n' "${AI_IMAGE:-}" "${AI_MODEL_FILE:-}" "${AI_MODEL_DIR:-}" "${HR_MODEL_SHA256:-}" "$*" >> "$MOCK_DIR/calls"
case "$1" in
 image)
  case "$2" in inspect) echo sha256:new ;; tag) exit 0 ;; *) exit 90 ;; esac ;;
 compose)
  while [[ $1 != -f ]]; do shift; done
  shift 2
  case "$1" in
   config) [[ ${MODE:-} != config-fails ]] ;;
   ps)
    if [[ -f $MOCK_DIR/active ]]; then cat "$MOCK_DIR/active"; elif [[ $EXISTING == 1 ]]; then echo old; fi ;;
   up)
    if [[ $AI_IMAGE == sha256:old ]]; then
     echo old > "$MOCK_DIR/active"
     [[ ${MODE:-} != rollback-fails ]]
    else
     echo new > "$MOCK_DIR/active"
     [[ ${MODE:-} != up-fails ]]
    fi ;;
   rm) : > "$MOCK_DIR/active"; touch "$MOCK_DIR/removed" ;;
   *) exit 91 ;;
  esac ;;
 inspect)
  case "$3" in
   '{{.Image}}') [[ ${!#} == old ]] && echo sha256:old || echo sha256:new ;;
   '{{.State.Running}}')
    if [[ ${!#} == new && ( ${MODE:-} == health-fails || ${MODE:-} == rollback-fails ) ]]; then echo false; else echo true; fi ;;
   '{{.State.Restarting}}') echo false ;;
   *'.Mounts'*) printf '%s\n' "$OLD_MODEL" ;;
   *) exit 92 ;;
  esac ;;
 exec)
  # 모의 모델 메타데이터와 상태 조회를 구분한다.
  if [[ "$*" != *urllib.request* ]]; then printf '%s\n' "$OLD_SHA"; fi ;;
 run) [[ ${MODE:-} != preflight-fails ]] ;;
 *) exit 93 ;;
esac
"""

@unittest.skipUnless(BASH and Path(BASH).exists(), "Bash 필요")
class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="runway-ai-cd-test-")
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        bin_path = self.path / "bin"
        bin_path.mkdir()
        for name, source in {
            "docker": DOCKER,
            "flock": '#!/usr/bin/env bash\n[[ ${MODE:-} != locked ]]\n',
        }.items():
            f = bin_path / name
            f.write_text(source, encoding="utf-8", newline="\n")
            f.chmod(0o755)
        self.compose = self.path / "compose.yaml"
        self.compose.write_text("services: {}\n", encoding="utf-8")
        self.state = self.path / "state"
        self.env = os.environ.copy()
        self.env.update(PATH=str(bin_path) + os.pathsep + self.env["PATH"], MOCK_DIR=self.posix(self.path),
                        EXISTING="1", OLD_MODEL="/models/previous/gru.pt", OLD_SHA="a" * 64,
                        COMPOSE_PROJECT_NAME="runway-ai-unit", MODE="")

    @staticmethod
    def posix(path):
        s = Path(path).as_posix()
        return "/" + s[0].lower() + s[2:] if os.name == "nt" else s

    def deploy(self, mode="", image="runway-ai:new", model="/models/next/gru.pt", sha=None):
        self.env["MODE"] = mode
        return subprocess.run([BASH, self.posix(ROOT / "deploy.sh"), image, self.posix(self.compose), model,
                               sha or "b" * 64, self.posix(self.state)], env=self.env, capture_output=True,
                              text=True, encoding="utf-8", errors="replace", timeout=15)

    def calls(self):
        f = self.path / "calls"
        return f.read_text(encoding="utf-8") if f.exists() else ""

    def test_first_deployment_records_release(self):
        self.env["EXISTING"] = "0"
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any(line.startswith("runway-ai:new|/models/next/gru.pt|/models/next|")
                            for line in self.calls().splitlines()))
        self.assertEqual((self.state / "current-release").read_text().splitlines(),
                         ["runway-ai:new", "/models/next/gru.pt", "b" * 64])

    def test_update_saves_previous_image_and_model(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.state / "previous-release").read_text().splitlines(),
                         ["sha256:old", "/models/previous/gru.pt", "a" * 64])

    def test_health_failure_restores_previous_pair_and_fails(self):
        result = self.deploy("health-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.path / "active").read_text().strip(), "old")
        self.assertEqual((self.state / "current-release").read_text().splitlines(),
                         ["sha256:old", "/models/previous/gru.pt", "a" * 64])

    def test_up_failure_also_restores_previous_pair(self):
        result = self.deploy("up-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.path / "active").read_text().strip(), "old")

    def test_preflight_failure_does_not_replace_service(self):
        result = self.deploy("preflight-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.path / "active").exists())
        self.assertNotIn("up -d", self.calls())

    def test_changed_model_requires_new_path(self):
        result = self.deploy(model=self.env["OLD_MODEL"])
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("up -d", self.calls())

    def test_first_failed_deployment_cleans_only_new_service(self):
        self.env["EXISTING"] = "0"
        result = self.deploy("health-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.path / "removed").exists())
        self.assertNotIn(" down", self.calls())

    def test_rollback_failure_does_not_record_success(self):
        result = self.deploy("rollback-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("수동 확인", result.stderr)
        self.assertFalse((self.state / "current-release").exists())

    def test_lock_prevents_any_docker_action(self):
        result = self.deploy("locked")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), "")

    def test_invalid_image_is_rejected(self):
        result = self.deploy(image="other:image")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), "")

if __name__ == "__main__":
    unittest.main()
