"""pnpm을 흉내 내 모바일 타입 검사·린트의 캐시 경로·키·실패 전파·정리 범위를 실제 Shell에서 검증한다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "infra/jenkins/check-mobile-static.sh"
SH = shutil.which("sh")
KEY_FILES = ("package.json", "pnpm-lock.yaml", "tsconfig.json", ".eslintrc.js", ".eslintignore", "babel.config.js")


@unittest.skipUnless(SH and shutil.which("sha256sum"), "sh와 sha256sum이 필요합니다")
class MobileStaticCheckTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        # 실제 frontend 대신 캐시 키 계산에 쓰는 설정 파일만 둔 최소 작업 폴더다.
        self.frontend = self.root / "frontend"
        self.frontend.mkdir()
        for name in KEY_FILES:
            (self.frontend / name).write_text(name + "\n", encoding="utf-8")
        self.cache = self.root / "cache"
        binary = self.root / "bin"
        binary.mkdir()
        pnpm = binary / "pnpm"
        pnpm.write_text("""#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
if [ "$1" = "$FAIL_COMMAND" ]; then exit 3; fi
""", encoding="utf-8", newline="\n")
        pnpm.chmod(0o755)
        self.log = self.root / "calls.txt"
        self.env = os.environ.copy()
        self.env.update(PATH=str(binary) + os.pathsep + self.env["PATH"], CALL_LOG=str(self.log),
                        MOBILE_STATIC_CACHE_DIR=str(self.cache), FAIL_COMMAND="")

    def run_script(self, failure=""):
        self.log.unlink(missing_ok=True)
        result = subprocess.run([SH, str(SCRIPT)], cwd=self.frontend, env={**self.env, "FAIL_COMMAND": failure},
                                capture_output=True, text=True, encoding="utf-8")
        calls = self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []
        return result.returncode, calls

    def cache_dirs(self):
        return sorted(path.name for path in self.cache.iterdir())

    def test_runs_full_typecheck_and_lint_with_persistent_cache(self):
        code, calls = self.run_script()
        self.assertEqual(code, 0, calls)
        [key] = self.cache_dirs()
        target = self.cache / key
        self.assertEqual(calls, [
            f"typecheck --incremental --tsBuildInfoFile {target}/tsc.tsbuildinfo",
            f"lint --cache --cache-strategy content --cache-location {target}/eslint-cache",
        ])

    def test_same_settings_reuse_key_and_changed_settings_use_new_key(self):
        self.run_script()
        first = self.cache_dirs()
        self.run_script()
        self.assertEqual(self.cache_dirs(), first)
        for name in KEY_FILES:
            with self.subTest(name=name):
                before = set(self.cache_dirs())
                with (self.frontend / name).open("a", encoding="utf-8") as file:
                    file.write("changed\n")
                code, _ = self.run_script()
                self.assertEqual(code, 0)
                self.assertEqual(len(set(self.cache_dirs()) - before), 1)

    def test_typecheck_failure_stops_before_lint(self):
        code, calls = self.run_script(failure="typecheck")
        self.assertEqual(code, 3)
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0].startswith("typecheck "))

    def test_lint_failure_is_reported(self):
        code, calls = self.run_script(failure="lint")
        self.assertEqual(code, 3)
        self.assertEqual(len(calls), 2)

    def test_prunes_only_other_caches_unused_for_more_than_seven_days(self):
        self.run_script()
        [key] = self.cache_dirs()
        old = time.time() - 8 * 24 * 3600
        for name in ("stale", "recent"):
            (self.cache / name).mkdir()
            (self.cache / name / "eslint-cache").write_text("{}", encoding="utf-8")
        os.utime(self.cache / "stale", (old, old))
        os.utime(self.cache / key, (old, old))
        code, _ = self.run_script()
        self.assertEqual(code, 0)
        # 현재 키는 오래됐어도 이번 실행이 사용하므로 유지하고 갱신한다.
        self.assertEqual(self.cache_dirs(), sorted([key, "recent"]))
        self.assertGreater((self.cache / key).stat().st_mtime, old)


if __name__ == "__main__":
    unittest.main()
