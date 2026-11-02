#!/usr/bin/env python3
"""RunWay DB·업로드 파일 백업. Linux 호스트에서 root로 실행한다."""

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile
import uuid


class BackupError(Exception):
    pass


def run(command, *, output=None, input_file=None):
    # 외부 명령의 오류 본문에는 데이터·인증정보가 있을 수 있어 출력하지 않는다.
    result = subprocess.run(command, stdin=input_file, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=1800, check=False)
    if result.returncode:
        categories = {b"already exists": "이미 존재하는 객체", b"duplicate key": "중복 키",
                      b"must be owner": "객체 소유권", b"does not exist": "필수 객체 없음",
                      b"permission denied": "권한 부족", b"unrecognized configuration parameter": "설정 호환성"}
        # 원본 오류 문자열은 반환하지 않고 알려진 범주 이름만 보고한다.
        category = next((label for phrase, label in categories.items()
                         if phrase in result.stderr.lower()), "도구 실행")
        raise BackupError(f"{Path(command[0]).name} 실행 실패 (exit={result.returncode}, 분류={category})")
    return result.stdout


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise BackupError("암호화 키는 실행 사용자 소유의 일반 파일·권한 600 이하가 필요합니다.")
    if info.st_size < 32:
        raise BackupError("암호화 키 파일이 너무 짧습니다.")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


@contextlib.contextmanager
def locked(root):
    import fcntl
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink() or root.stat().st_mode & 0o077 or root.stat().st_uid != os.geteuid():
        raise BackupError("자동 백업 폴더는 실행 사용자 소유·권한 700이어야 합니다.")
    with (root / ".lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("다른 백업이 실행 중입니다.") from None
        yield


def retain(root, keep, prefix="data"):
    # 이 스크립트가 완성한 백업 쌍만 대상으로 한다. 기존 수동 백업은 제외한다.
    if keep < 1:
        raise BackupError("보관 개수는 1 이상이어야 합니다.")
    completed = []
    if prefix not in {"data", "jenkins"}:
        raise BackupError("허용하지 않은 백업 종류입니다.")
    for manifest in root.glob(prefix + "-*.json"):
        if not re.fullmatch(re.escape(prefix) + r"-\d{8}T\d{6}Z-[0-9a-f]{8}\.json", manifest.name):
            continue
        archive = manifest.with_suffix(".tar.gpg")
        if manifest.is_symlink() or archive.is_symlink():
            continue
        try:
            record = json.loads(manifest.read_text(encoding="utf-8"))
            valid = (record.get("format") == 1 and record.get("archive") == archive.name
                     and record.get("sha256") == digest(archive))
        except (OSError, ValueError):
            continue
        if valid:
            completed.append((manifest, archive))
    for manifest, archive in sorted(completed, reverse=True)[keep:]:
        manifest.unlink()
        archive.unlink()


def regular_member(info):
    # 백업 대상 밖의 파일을 따라가지 않으며 장치·소켓도 보관하지 않는다.
    if not (info.isfile() or info.isdir()):
        raise BackupError("백업 대상에 일반 파일·디렉터리 외의 항목이 있습니다.")
    return info


def encrypt_archive(key_file, encrypted, sources):
    """파일 내용·명령 오류를 출력하지 않고 tar 스트림을 AES256으로 암호화한다."""
    with tempfile.TemporaryDirectory(prefix=".gpg-", dir=encrypted.parent) as home:
        command = ["gpg", "--homedir", home, "--batch", "--pinentry-mode", "loopback",
                   "--no-symkey-cache", "--passphrase-file", str(key_file),
                   "--symmetric", "--cipher-algo", "AES256", "--output", str(encrypted)]
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                       stderr=errors)
            try:
                with tarfile.open(fileobj=process.stdin, mode="w|") as archive:
                    for path, name in sources:
                        archive.add(path, arcname=name, filter=regular_member)
                process.stdin.close()
                if process.wait(timeout=1800):
                    raise BackupError("백업 암호화 실패")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    with encrypted.open("rb") as stream:
        os.fsync(stream.fileno())


def backup(args):
    os.umask(0o077)
    private_file(args.key_file)
    if args.keep < 1 or not args.images.is_dir() or args.images.is_symlink():
        raise BackupError("보관 개수 또는 이미지 폴더를 확인하세요.")
    started = dt.datetime.now(dt.timezone.utc)
    name = "data-" + started.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    with locked(args.destination):
        # 임시 평문도 root 전용 폴더에 두며, 성공·실패 모두 정리한다.
        with tempfile.TemporaryDirectory(prefix=".pending-", dir=args.destination) as temp:
            stage = Path(temp)
            db = ["docker", "exec", args.container]
            image_id = run(["docker", "inspect", "--format", "{{.Image}}", args.container]).decode().strip()
            with (stage / "database.dump").open("wb") as target:
                run(db + ["pg_dump", "-U", "runway_admin", "-d", "runway", "-Fc"], output=target)
            with (stage / "roles.sql").open("wb") as target:
                run(db + ["pg_dumpall", "-U", "runway_admin", "--roles-only", "--no-role-passwords"], output=target)
            # 덤프 헤더가 읽히는지 먼저 확인한다. 실제 복원 성공은 별도 검증한다.
            with (stage / "database.dump").open("rb") as source:
                run(db[:2] + ["-i", args.container, "pg_restore", "--list"], input_file=source,
                    output=subprocess.DEVNULL)
            metadata = {"format": 1, "database": "runway", "db_image_id": image_id,
                        "started_utc": started.isoformat(), "roles_include_passwords": False,
                        "images_consistency": "live-files-not-a-database-transaction"}
            (stage / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
            # tar를 암호화 프로세스로 직접 전달해 평문 tar 사본은 만들지 않는다.
            encrypted = stage / "archive.gpg"
            encrypt_archive(args.key_file, encrypted,
                            [(stage / filename, filename) for filename in
                             ("database.dump", "roles.sql", "metadata.json")] + [(args.images, "images")])
            archive_name = name + ".tar.gpg"
            record = {"format": 1, "archive": archive_name, "sha256": digest(encrypted),
                      "bytes": encrypted.stat().st_size, "started_utc": started.isoformat(),
                      "completed_utc": dt.datetime.now(dt.timezone.utc).isoformat()}
            manifest = stage / "manifest.json"
            manifest.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            # manifest가 최종 성공 표시다. 실패한 실행은 보관 개수에 포함하지 않는다.
            encrypted.replace(args.destination / archive_name)
            manifest.replace(args.destination / (name + ".json"))
        retain(args.destination, args.keep)
    print(f"DB·이미지 암호화 백업 완료: {archive_name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--destination", type=Path, default=Path("/home/ubuntu/runway/backups/automatic/data"))
    parser.add_argument("--images", type=Path, default=Path("/home/ubuntu/runway/data/images"))
    parser.add_argument("--container", default="runway-db-db-1")
    parser.add_argument("--keep", type=int, default=7)
    args = parser.parse_args()
    try:
        backup(args)
    except (BackupError, OSError, subprocess.SubprocessError, tarfile.TarError):
        # 상세 예외에는 파일 내용이 섞일 수 있으므로 인증정보 없는 고정 메시지만 출력한다.
        parser.exit(1, "백업 실패: 원본 데이터와 기존 성공 백업은 유지됩니다. 도구·권한·디스크 상태를 확인하세요.\n")


if __name__ == "__main__":
    main()
