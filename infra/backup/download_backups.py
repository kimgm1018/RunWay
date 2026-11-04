#!/usr/bin/env python3
"""PC에서 암호화 백업과 분리 복구 자료를 다운로드한다. 키 값을 출력하지 않는다."""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import uuid


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def valid_name(name):
    if not re.fullmatch(r"(?:data|jenkins)-\d{8}T\d{6}Z-[0-9a-f]{8}\.(?:tar\.gpg|json|master-key\.tar\.gpg)", name):
        raise ValueError("백업 파일 이름 오류")
    return name


def protect(path):
    if path.is_symlink():
        raise ValueError("링크 폴더는 사용하지 않습니다.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name == "nt":
        account = getpass.getuser()
        domain = os.environ.get("USERDOMAIN")
        if domain:
            account = domain + "\\" + account
        result = subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r",
                                 account + ":(OI)(CI)F"], capture_output=True)
        if result.returncode:
            raise ValueError("로컬 백업 폴더 권한 제한 실패")
    else:
        path.chmod(0o700)


def ssh(args, *remote):
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-i", str(args.identity),
            args.host, "sudo python3 /usr/local/lib/runway-backup/export_backup.py "
            + " ".join(shlex.quote(item) for item in remote)]


def fetch(args, remote, destination, expected=None, key=False):
    if not key:
        valid_name(remote)
    if destination.exists() and expected and not destination.is_symlink() and digest(destination) == expected:
        return
    temporary = destination.with_name("." + destination.name + "." + uuid.uuid4().hex + ".partial")
    try:
        with temporary.open("xb") as target:
            result = subprocess.run(ssh(args, "--file", remote), stdout=target, stderr=subprocess.DEVNULL, timeout=1800)
            target.flush()
            os.fsync(target.fileno())
        if result.returncode:
            raise ValueError("SSH 다운로드 실패")
        if expected and digest(temporary) != expected:
            raise ValueError("다운로드 해시 불일치")
        if key and not re.fullmatch(rb"[0-9a-f]{64}\n?", temporary.read_bytes()):
            raise ValueError("복구 키 파일 형식 오류")
        if destination.is_symlink():
            raise ValueError("대상 파일이 링크입니다.")
        if destination.exists():
            if digest(destination) != digest(temporary):
                raise ValueError("기존 파일과 다른 값입니다. 기존 복구 자료를 보존합니다.")
        else:
            temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def download(args):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]*", args.host) or not args.identity.is_file():
        raise ValueError("SSH 대상·키 파일 경로 오류")
    listing = subprocess.run(ssh(args, "--latest"), capture_output=True, timeout=60)
    if listing.returncode:
        raise ValueError("서버 백업 목록 확인 실패")
    records = json.loads(listing.stdout)
    if not records:
        raise ValueError("다운로드할 성공 백업 없음")
    home = Path.home()
    backup_root = home / "RunWayBackups"
    recovery_root = home / "RunWayRecovery"
    protect(backup_root)
    protect(recovery_root)
    # 복호화 키는 일반 백업 폴더와 분리한다. 원래 값은 출력·로그에 기록하지 않는다.
    fetch(args, "runway-backup-key", recovery_root / "runway-backup-key", key=True)
    kinds = set()
    for record in records:
        kind = record["kind"]
        if kind not in {"data", "jenkins"}:
            raise ValueError("백업 종류 오류")
        folder = backup_root / kind
        protect(folder)
        archive = valid_name(record["archive"])
        if not archive.startswith(kind + "-") or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
            raise ValueError("백업 메타데이터 오류")
        fetch(args, archive, folder / archive, record["sha256"])
        manifest = valid_name(record["manifest"])
        fetch(args, manifest, folder / manifest)
        if kind == "jenkins":
            recovery = valid_name(record["recovery_archive"])
            if not re.fullmatch(r"[0-9a-f]{64}", record["recovery_sha256"]):
                raise ValueError("복구 자료 해시 오류")
            fetch(args, recovery, recovery_root / recovery, record["recovery_sha256"])
        kinds.add(kind)
        print(kind + " 암호화 백업 다운로드·해시 확인 완료")
    print("복구 키 분리 보관 완료 (값 출력 없음)")
    print("백업: " + str(backup_root))
    print("복구 자료: " + str(recovery_root))
    if "jenkins" not in kinds:
        print("Jenkins 완료 백업은 아직 없습니다. 생성 후 같은 명령을 다시 실행하세요.")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--host", default="ubuntu@k15e105.p.ssafy.io")
    args = parser.parse_args()
    try:
        download(args)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        parser.exit(1, "백업 다운로드 실패: SSH 연결·권한·완료 백업을 확인하세요. 기존 파일은 유지됩니다.\n")


if __name__ == "__main__":
    main()
