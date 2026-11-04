#!/usr/bin/env python3
"""백업 암호화 키를 처음 한 번만 생성하며 값은 출력하지 않는다."""

import os
from pathlib import Path
import secrets

from backup import private_file


if __name__ == "__main__":
    os.umask(0o077)
    path = Path("/root/runway-backup-key")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        private_file(path)
        print("기존 백업 키 유지")
    else:
        with os.fdopen(descriptor, "w") as target:
            target.write(secrets.token_hex(32) + "\n")
            target.flush()
            os.fsync(target.fileno())
        print("백업 키 생성 완료 (값 출력 없음)")
