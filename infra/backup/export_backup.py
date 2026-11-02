#!/usr/bin/env python3
"""PC 다운로드 전용. 바이너리·키 출력은 반드시 호출 프로그램의 파일로 받는다."""
import argparse
import json
from pathlib import Path
import re
import shutil
import sys
from backup import digest

ROOT = Path("/home/ubuntu/runway/backups/automatic")


def locate(name):
    if re.fullmatch(r"data-\d{8}T\d{6}Z-[0-9a-f]{8}\.(?:tar\.gpg|json)", name):
        return ROOT / "data" / name
    if re.fullmatch(r"jenkins-\d{8}T\d{6}Z-[0-9a-f]{8}\.(?:tar\.gpg|json)", name):
        return ROOT / "jenkins" / name
    if re.fullmatch(r"jenkins-\d{8}T\d{6}Z-[0-9a-f]{8}\.master-key\.tar\.gpg", name):
        return ROOT / "recovery" / name
    if name == "runway-backup-key":
        return Path("/root/runway-backup-key")
    raise ValueError("허용하지 않은 파일 이름")


def latest():
    result = []
    for kind in ("data", "jenkins"):
        for path in sorted((ROOT / kind).glob(kind + "-*.json"), reverse=True):
            if path.is_symlink():
                continue
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                archive = locate(record["archive"])
                if (record.get("format") != 1 or archive.parent != ROOT / kind
                        or archive.is_symlink() or digest(archive) != record["sha256"]):
                    continue
                if kind == "jenkins":
                    recovery = locate(record["recovery_archive"])
                    if (recovery.parent != ROOT / "recovery" or recovery.is_symlink()
                            or digest(recovery) != record["recovery_sha256"]):
                        continue
                result.append(dict(record, kind=kind, manifest=path.name))
                break
            except (OSError, ValueError, KeyError):
                continue
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--latest", action="store_true")
    choice.add_argument("--file")
    args = parser.parse_args()
    try:
        if args.latest:
            print(json.dumps(latest()))
        else:
            path = locate(args.file)
            if path.is_symlink() or not path.is_file():
                raise ValueError("일반 파일만 다운로드 가능")
            with path.open("rb") as source:
                shutil.copyfileobj(source, sys.stdout.buffer)
    except (OSError, ValueError):
        parser.exit(1, "백업 내보내기 실패: 파일·권한을 확인하세요.\n")


if __name__ == "__main__":
    main()
