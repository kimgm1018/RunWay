#!/usr/bin/env python3
"""ThinBackup의 완료된 전체 백업만 암호화한다. Jenkins를 중단하지 않는다."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import uuid

from backup import BackupError, digest, encrypt_archive, locked, private_file, retain, run


def completed_snapshots(root):
    return sorted(path for path in root.iterdir()
                  if re.fullmatch(r"FULL-[0-9_-]+", path.name) and path.is_dir()
                  and not path.is_symlink() and (path / "backup-completed.info").is_file())


def fingerprint(root):
    if root.is_symlink() or not root.is_dir():
        raise BackupError("백업 원본은 링크가 아닌 디렉터리여야 합니다.")
    result = []
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
            raise BackupError("백업 원본에 허용하지 않은 링크·특수 파일이 있습니다.")
        result.append((str(path.relative_to(root)), info.st_size, info.st_mtime_ns))
    return result


def already_saved(destination, snapshot):
    for path in destination.glob("jenkins-*.json"):
        if path.is_symlink():
            continue
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            name = record.get("archive", "")
            if not re.fullmatch(r"jenkins-\d{8}T\d{6}Z-[0-9a-f]{8}\.tar\.gpg", name):
                continue
            archive = destination / name
            if (record.get("source") == snapshot.name
                    and record.get("source_completed_ns") == (snapshot / "backup-completed.info").stat().st_mtime_ns
                    and not archive.is_symlink()
                    and digest(archive) == record.get("sha256")):
                recovery = destination.parent / "recovery" / record["recovery_archive"]
                if (recovery.name == record["recovery_archive"] and not recovery.is_symlink()
                        and digest(recovery) == record.get("recovery_sha256")):
                    return True
        except (OSError, ValueError, KeyError):
            pass
    return False


def collect(args):
    os.umask(0o077)
    private_file(args.key_file)
    source = args.home / "runway-backup-staging"
    if not source.is_dir() or source.is_symlink():
        raise BackupError("ThinBackup 임시 폴더가 없습니다.")
    recovery_dir = args.destination.parent / "recovery"
    with locked(args.destination), locked(recovery_dir):
        snapshots = completed_snapshots(source)
        if not snapshots:
            print("ThinBackup 전체 백업 완료 대기 중")
            return
        snapshot = snapshots[-1]
        if already_saved(args.destination, snapshot):
            print("최신 Jenkins 백업은 이미 암호화되어 있습니다.")
            return
        if not (snapshot / "config.xml").is_file() or not (snapshot / "plugins").is_dir():
            raise BackupError("Jenkins 설정 또는 플러그인 백업이 누락되었습니다.")
        if (snapshot / "secrets/master.key").exists():
            raise BackupError("master.key가 일반 백업에 포함되어 있습니다. ThinBackup 대상을 확인하세요.")
        original = fingerprint(snapshot)
        secrets_dir = args.home / "secrets"
        secrets_before = fingerprint(secrets_dir)
        completed_ns = (snapshot / "backup-completed.info").stat().st_mtime_ns
        if any(item[2] > completed_ns for item in secrets_before):
            raise BackupError("백업 완료 후 복구 키가 변경되었습니다. ThinBackup을 다시 실행하세요.")
        started = dt.datetime.now(dt.timezone.utc)
        name = "jenkins-" + started.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
        with tempfile.TemporaryDirectory(prefix=".pending-", dir=args.destination) as directory:
            stage = Path(directory)
            copied = stage / "jenkins"
            shutil.copytree(snapshot, copied)
            shutil.copytree(secrets_dir, copied / "secrets", dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("master.key"))
            for filename in ("secret.key", "secret.key.not-so-secret", "identity.key.enc"):
                path = args.home / filename
                if path.exists():
                    if path.is_symlink() or not path.is_file() or path.stat().st_mtime_ns > completed_ns:
                        raise BackupError("Jenkins 복구 자료가 변경되었거나 형식이 올바르지 않습니다.")
                    shutil.copy2(path, copied / filename)
            master = secrets_dir / "master.key"
            if not master.is_file() or master.is_symlink():
                raise BackupError("분리 보관할 Jenkins master.key가 없습니다.")
            encrypted = stage / "jenkins.gpg"
            recovery = stage / "recovery.gpg"
            image = run(["docker", "inspect", "--format", "{{.Image}}", "runway-ci-jenkins-1"]).decode().strip()
            encrypt_archive(args.key_file, encrypted, [(copied, "jenkins")])
            encrypt_archive(args.key_file, recovery, [(master, "master.key")])
            if original != fingerprint(snapshot) or secrets_before != fingerprint(secrets_dir):
                raise BackupError("암호화 중 백업 원본이 변경되어 성공 처리하지 않았습니다.")
            archive_name = name + ".tar.gpg"
            recovery_name = name + ".master-key.tar.gpg"
            record = {"format": 1, "archive": archive_name, "sha256": digest(encrypted),
                      "bytes": encrypted.stat().st_size, "source": snapshot.name,
                      "source_completed_ns": completed_ns,
                      "jenkins_image_id": image,
                      "recovery_archive": recovery_name, "recovery_sha256": digest(recovery),
                      "started_utc": started.isoformat(),
                      "completed_utc": dt.datetime.now(dt.timezone.utc).isoformat()}
            manifest = stage / "manifest.json"
            manifest.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            recovery.replace(recovery_dir / recovery_name)
            encrypted.replace(args.destination / archive_name)
            manifest.replace(args.destination / (name + ".json"))
        retain(args.destination, 4, prefix="jenkins")
        # 분리 복구 키는 아직 PC로 내려받지 않았을 수 있어 여기서 자동 삭제하지 않는다.
    print("Jenkins 설정 암호화 완료·master.key 분리 보관 완료")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--home", type=Path,
                        default=Path("/var/lib/docker/volumes/runway_jenkins_home/_data"))
    parser.add_argument("--destination", type=Path,
                        default=Path("/home/ubuntu/runway/backups/automatic/jenkins"))
    args = parser.parse_args()
    try:
        collect(args)
    except BackupError as error:
        parser.exit(1, f"Jenkins 백업 암호화 실패: {error}\n")
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError):
        parser.exit(1, "Jenkins 백업 암호화 실패: 기존 백업은 유지됩니다. 권한·디스크·도구 상태를 확인하세요.\n")


if __name__ == "__main__":
    main()
