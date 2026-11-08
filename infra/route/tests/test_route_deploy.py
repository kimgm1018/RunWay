"""Route 교체 성공·이전 이미지 복구·최초 실패 정리를 모의 Docker로 검증한다."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASH = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe" if os.name == "nt" else Path("/bin/bash")


def posix(path):
    value = Path(path).as_posix()
    return "/" + value[0].lower() + value[2:] if os.name == "nt" else value


STUB = r'''#!/usr/bin/env bash
set -eu
printf '%s :: %s\n' "${ROUTE_IMAGE:-none}" "$*" >> "$MOCK_DIR/calls"
case "$1 $2" in
  'image inspect') [[ ${!#} == runway-route:test ]] && echo sha256:new || echo sha256:old ;;
  'image tag') exit 0 ;;
  'compose -f')
    shift 3
    case "$1" in
      config) exit 0 ;;
      ps) if [[ -f $MOCK_DIR/active ]]; then cat "$MOCK_DIR/active"; elif [[ ${INITIAL:-} != true ]]; then echo old; fi ;;
      up) [[ $ROUTE_IMAGE == sha256:old ]] && echo old > "$MOCK_DIR/active" || echo new > "$MOCK_DIR/active" ;;
      *) exit 90 ;;
    esac ;;
  'inspect -f')
    case "$3" in
      '{{.Image}}') [[ ${!#} == new ]] && echo sha256:new || echo sha256:old ;;
      '{{.State.Running}}') echo true ;;
      '{{.State.Health.Status}}') echo healthy ;;
      '{{.State.StartedAt}}') echo stable ;;
      *) exit 91 ;;
    esac ;;
  'run --rm')
    [[ ${FAIL_PROBE:-} != true || $(cat "$MOCK_DIR/active") == old ]] ;;
  'rm -f') rm -f "$MOCK_DIR/active" ;;
  *) exit 92 ;;
esac
'''


class RouteDeployTests(unittest.TestCase):
    def run_deploy(self, initial=False, failure=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in (("docker", STUB), ("flock", "#!/bin/sh\nexit 0\n")):
                path = root / name
                path.write_text(source, encoding="utf-8", newline="\n")
                path.chmod(0o755)
            compose = root / "compose.yaml"
            compose.write_text("services: {}")
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ["PATH"],
                       MOCK_DIR=posix(root), ROUTE_DEPLOY_STATE_DIR=posix(root / "state"),
                       INITIAL=str(initial).lower(), FAIL_PROBE=str(failure).lower())
            result = subprocess.run([str(BASH), posix(ROOT / "deploy.sh"),
                "runway-route:test", posix(compose)], env=env, capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=20)
            calls = (root / "calls").read_text(encoding="utf-8")
            active = (root / "active").read_text().strip() if (root / "active").exists() else None
            return result, calls, active

    def test_success(self):
        result, calls, active = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(active, "new")

    def test_failed_probe_restores_previous_image(self):
        result, calls, active = self.run_deploy(failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(active, "old")
        self.assertIn("sha256:old :: compose", calls)

    def test_initial_failed_probe_removes_only_new_container(self):
        result, calls, active = self.run_deploy(initial=True, failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(active)
        self.assertIn("rm -f new", calls)


if __name__ == "__main__":
    unittest.main()
