#!/usr/bin/env python3
"""암호화 백업을 외부 연결 없는 임시 DB에 복원하고 정리한다."""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import time
import uuid

from backup import BackupError, digest, private_file, run


def extract(archive, target):
    # 일반 파일만 허용하고 경로 탈출·링크·중복 멤버를 차단한다.
    seen = set()
    with tarfile.open(archive) as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or member.name in seen or not (member.isfile() or member.isdir())):
                raise BackupError("복원 아카이브 형식이 올바르지 않습니다.")
            if member.name not in {"database.dump", "roles.sql", "metadata.json", "images"} and not member.name.startswith("images/"):
                raise BackupError("복원 아카이브에 예상하지 않은 경로가 있습니다.")
            seen.add(member.name)
            destination = target.joinpath(*path.parts)
            if member.isdir():
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with source.extractfile(member) as reader, destination.open("xb") as writer:
                    import shutil
                    shutil.copyfileobj(reader, writer)
    if not {"database.dump", "roles.sql", "metadata.json", "images"} <= seen:
        raise BackupError("필수 백업 파일이 누락되었습니다.")


def verify(args):
    os.umask(0o077)
    private_file(args.key_file)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    filename = manifest["archive"]
    if not re.fullmatch(r"data-\d{8}T\d{6}Z-[0-9a-f]{8}\.tar\.gpg", filename):
        raise BackupError("백업 파일 이름이 올바르지 않습니다.")
    archive = args.manifest.parent / filename
    if archive.is_symlink() or manifest.get("format") != 1 or digest(archive) != manifest["sha256"]:
        raise BackupError("백업 파일 무결성 확인 실패")
    started = time.monotonic()
    name = "runway-restore-check-" + uuid.uuid4().hex
    created = False
    # 임시 평문은 root만 읽으며 정상·실패 종료 모두 정리한다.
    with tempfile.TemporaryDirectory(prefix="runway-restore-") as directory:
        temp = Path(directory)
        home = temp / "gpg"
        home.mkdir(mode=0o700)
        run(["gpg", "--homedir", str(home), "--batch", "--pinentry-mode", "loopback",
             "--no-symkey-cache", "--passphrase-file", str(args.key_file),
             "--output", str(temp / "data.tar"), "--decrypt", str(archive)])
        data = temp / "data"
        data.mkdir(mode=0o700)
        extract(temp / "data.tar", data)
        print("암호화 해제·백업 파일 검사 통과", flush=True)
        metadata = json.loads((data / "metadata.json").read_text(encoding="utf-8"))
        image = metadata["db_image_id"]
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
            raise BackupError("DB 이미지 ID가 올바르지 않습니다.")
        try:
            # 포트·운영 볼륨을 연결하지 않고 종료 시 삭제되는 tmpfs를 사용한다.
            run(["docker", "create", "--name", name, "--label", "runway.restore-check=true",
                 "--network", "none", "--memory", "1g", "--cpus", "1", "--shm-size", "128m",
                 "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
                 "-e", "POSTGRES_USER=runway_restore_admin", "-e", "POSTGRES_DB=runway",
                 "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image])
            created = True
            run(["docker", "start", name])
            deadline = time.monotonic() + 120
            while True:
                try:
                    run(["docker", "exec", name, "pg_isready", "-U", "runway_restore_admin", "-d", "runway"])
                    # init 스크립트의 임시 서버가 아니라 최종 서버인지 확인한다.
                    ready = run(["docker", "exec", name, "psql", "-X", "-U", "runway_restore_admin",
                                 "-d", "runway", "-Atc", "SELECT pg_postmaster_start_time() IS NOT NULL"])
                    command = run(["docker", "exec", name, "cat", "/proc/1/comm"]).decode().strip()
                    if ready.strip() == b"t" and command == "postgres":
                        break
                except BackupError:
                    pass
                if time.monotonic() >= deadline:
                    raise BackupError("임시 DB 시작 시간 초과")
                time.sleep(1)
            print("격리 DB 시작 완료", flush=True)
            with (data / "roles.sql").open("rb") as source:
                run(["docker", "exec", "-i", name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                     "-U", "runway_restore_admin", "-d", "runway"], input_file=source)
            print("DB 역할 복원 완료", flush=True)
            with (data / "database.dump").open("rb") as source:
                run(["docker", "exec", "-i", name, "pg_restore", "--clean", "--if-exists",
                     "--exit-on-error", "--single-transaction",
                     "-U", "runway_restore_admin", "-d", "runway"], input_file=source)
            print("DB 덤프 복원 완료", flush=True)
            # 개인 데이터는 출력하지 않는다. 역할·공간 확장·테이블 접근만 검증한다.
            sql = ("SELECT current_user = 'runway_app' AND "
                   "EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AND "
                   "EXISTS (SELECT 1 FROM public.flyway_schema_history) AND "
                   "NOT EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE NOT success)")
            status = run(["docker", "exec", name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                          "-U", "runway_app", "-d", "runway", "-Atc", sql])
            if status.strip() != b"t":
                raise BackupError("복원 후 역할·PostGIS·Flyway 상태 검사 실패")
        finally:
            if created:
                run(["docker", "rm", "--force", "--volumes", name])
    print(f"격리 DB 복원·앱 역할·PostGIS·Flyway 검사 통과 ({time.monotonic() - started:.1f}초)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", type=Path)
    source.add_argument("--latest-dir", type=Path, help="지정 폴더의 가장 최근 성공 기록 사용")
    parser.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.latest_dir:
            manifests = sorted(path for path in args.latest_dir.glob("data-*.json")
                               if re.fullmatch(r"data-\d{8}T\d{6}Z-[0-9a-f]{8}\.json", path.name)
                               and not path.is_symlink())
            if not manifests:
                raise BackupError("성공한 백업이 없습니다.")
            args.manifest = manifests[-1]
        verify(args)
    except BackupError as error:
        parser.exit(1, f"격리 복원 검증 실패: {error}\n운영 DB는 변경하지 않았습니다.\n")
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, tarfile.TarError):
        parser.exit(1, "격리 복원 검증 실패: 운영 DB는 변경하지 않았습니다. 백업·도구·리소스를 확인하세요.\n")


if __name__ == "__main__":
    main()
