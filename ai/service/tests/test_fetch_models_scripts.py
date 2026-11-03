"""모델 다운로드 스크립트의 인증·해시 동작을 네트워크 없이 확인한다."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess

import pytest


SERVICE_DIR = Path(__file__).resolve().parents[1]
SCRIPT_DIR = SERVICE_DIR / "scripts"
FAKE_HF_TOKEN = "hf-test-token-must-not-appear-in-curl-arguments"


def _find_bash() -> str | None:
    if os.name != "nt":
        return shutil.which("bash")

    git_roots: list[Path] = []
    git = shutil.which("git")
    if git is not None:
        git_dir = Path(git).resolve().parent
        git_roots.extend((git_dir, *git_dir.parents))
    git_roots.append(Path("C:/Program Files/Git"))

    candidates = [root / "usr" / "bin" / "bash.exe" for root in git_roots]
    candidates.extend(root / "bin" / "bash.exe" for root in git_roots)

    for candidate in candidates:
        resolved_candidate = candidate.resolve()
        blocked_dirs = {part.casefold() for part in resolved_candidate.parts}
        if blocked_dirs.intersection({"system32", "windowsapps"}):
            continue
        if resolved_candidate.is_file():
            return str(resolved_candidate)
    return None


def _bash_compatible_path(path: Path, bash: str) -> str:
    if os.name != "nt":
        return str(path)

    bash_path = Path(bash).resolve()
    cygpath_candidates = [bash_path.with_name("cygpath.exe")]
    cygpath_candidates.extend(
        parent / "usr" / "bin" / "cygpath.exe" for parent in bash_path.parents
    )
    cygpath = next(
        (candidate for candidate in cygpath_candidates if candidate.is_file()),
        None,
    ) or shutil.which("cygpath")
    if cygpath is not None:
        try:
            result = subprocess.run(
                [cygpath, "-u", str(path)],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except OSError:
            pass

    windows_path = path.resolve().as_posix()
    drive, separator, remainder = windows_path.partition(":")
    if separator and len(drive) == 1 and drive.isalpha():
        return f"/{drive.lower()}/{remainder.lstrip('/')}"
    return windows_path


def test_scripts_keep_token_out_of_curl_arguments_and_require_private_hf_auth():
    bash = (SCRIPT_DIR / "fetch_models.sh").read_text(encoding="utf-8")
    powershell = (SCRIPT_DIR / "fetch_models.ps1").read_text(encoding="utf-8")

    assert not re.search(r"(?m)^\s*set\s+-[^\n]*x", bash)
    assert "-H @-" in bash
    assert not re.search(r"-H\s+[\"']Authorization\s*:", bash)
    assert not re.search(r"--header(?:=|\s)", bash)
    assert "HF_TOKEN" in bash and "HF_TOKEN is required" in bash
    assert "Invoke-WebRequest" in powershell
    assert "-Headers @{ Authorization = \"Bearer $env:HF_TOKEN\" }" in powershell
    assert "HF_TOKEN" in powershell and "HF_TOKEN is required" in powershell
    assert "AnSeongYun/runway-hr-models" in bash
    assert "AnSeongYun/runway-hr-models" in powershell
    assert "11a3d0cce3062c84aa7ffee1740a93d204462190" in bash
    assert "11a3d0cce3062c84aa7ffee1740a93d204462190" in powershell


def _shell_service(tmp_path: Path) -> tuple[Path, Path, dict[str, str], bytes]:
    bash = _find_bash()
    if bash is None:
        pytest.skip("Git Bash is not installed" if os.name == "nt" else "bash is not installed")

    service_dir = tmp_path / "service"
    scripts_dir = service_dir / "scripts"
    scripts_dir.mkdir(parents=True)
    script = scripts_dir / "fetch_models.sh"
    shutil.copy2(SCRIPT_DIR / "fetch_models.sh", script)

    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >> "$FAKE_CURL_ARGS_FILE"
cat >/dev/null
output=''
while (($#)); do
  if [[ "$1" == '-o' || "$1" == '--output' ]]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
[[ -n "$output" ]]
cp -- "$FAKE_CURL_RESPONSE" "$output"
""",
        encoding="utf-8",
    )
    fake_curl.chmod(0o755)

    payload = b"network-free fake model artifact\n"
    response = tmp_path / "response.bin"
    response.write_bytes(payload)
    args_file = tmp_path / "curl-args.txt"
    env = os.environ.copy()
    for name in (
        "ODEV21_SOURCE_CHECKPOINT",
        "ODEV21_SOURCE_STATS",
        "ODEV21_POPULATION_BUNDLE_SOURCE",
        "GRU_MODEL_URL",
    ):
        env.pop(name, None)
    env["FAKE_BIN"] = _bash_compatible_path(fake_bin, bash)
    proxy = "http://127.0.0.1:9"
    for name in (
        "http_proxy",
        "https_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "all_proxy",
    ):
        env[name] = proxy
    for name in ("NO_PROXY", "no_proxy"):
        env[name] = ""
    env.update(
        {
            "HF_TOKEN": FAKE_HF_TOKEN,
            "ODEV21_SOURCE_MODE": "hf",
            "RUNWAY_MODEL_HF_REPO": "test/repo",
            "RUNWAY_MODEL_HF_REVISION": "test-revision",
            "FAKE_CURL_RESPONSE": response.as_posix(),
            "FAKE_CURL_ARGS_FILE": args_file.as_posix(),
        }
    )
    digest = hashlib.sha256(payload).hexdigest()
    for name in (
        "GRU_MODEL_SHA256",
        "ODEV21_CHECKPOINT_SHA256",
        "ODEV21_SUMMARY_STATS_SHA256",
        "ODEV21_POPULATION_BUNDLE_SHA256",
    ):
        env[name] = digest
    env["TEST_BASH"] = bash
    return script, args_file, env, payload


def _run_shell(script: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            env["TEST_BASH"],
            "-c",
            'PATH="$FAKE_BIN:/usr/bin:/bin:/mingw64/bin:$PATH"; export PATH; exec "$BASH" "$0"',
            script.as_posix(),
        ],
        cwd=script.parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_bash_downloads_and_verifies_all_four_assets_with_fake_curl(tmp_path):
    script, args_file, env, payload = _shell_service(tmp_path)

    result = _run_shell(script, env)

    assert result.returncode == 0, result.stderr
    model_dir = script.parents[1] / "models"
    installed = (
        model_dir / "gru_final.pt",
        model_dir / "ode" / "ode_epoch_020.pt",
        model_dir / "ode" / "ode_summary_stats.json",
        model_dir / "ode" / "population_bundle_v2train_median.json",
    )
    assert all(path.read_bytes() == payload for path in installed)
    assert not list(model_dir.rglob("*.download*"))
    assert args_file.is_file()
    arguments = args_file.read_text(encoding="utf-8")
    assert FAKE_HF_TOKEN not in arguments
    assert arguments.count("https://huggingface.co/test/repo/resolve/test-revision/") == 4


def test_bash_sha_mismatch_fails_and_removes_temporary_download(tmp_path):
    script, _args_file, env, _payload = _shell_service(tmp_path)
    for name in (
        "GRU_MODEL_SHA256",
        "ODEV21_CHECKPOINT_SHA256",
        "ODEV21_SUMMARY_STATS_SHA256",
        "ODEV21_POPULATION_BUNDLE_SHA256",
    ):
        env[name] = "0" * 64

    result = _run_shell(script, env)

    assert result.returncode != 0
    model_dir = script.parents[1] / "models"
    assert not list(model_dir.rglob("*.download*"))
    assert not (model_dir / "gru_final.pt").exists()


def test_bash_requires_hf_token_before_starting_download(tmp_path):
    script, args_file, env, _payload = _shell_service(tmp_path)
    env.pop("HF_TOKEN")

    result = _run_shell(script, env)

    assert result.returncode != 0
    assert "HF_TOKEN is required" in result.stderr
    assert not args_file.exists()
