"""고정 HF Route 데이터 묶음을 검증해 버전 폴더로 준비한다."""
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from urllib.request import Request, build_opener

from prepare_models import SafeRedirect, digest

REPOSITORY = "AnSeongYun/runway-hr-models"
REVISION = "4952478476ce2d76579e1b6ba16363214e6a6914"
PREFIX = "route_data_v2"
ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|")


def manifest_files(text):
    files = []
    for line in text.splitlines():
        match = ROW.match(line)
        if not match:
            continue
        path, size, sha = match.groups()
        if (not re.fullmatch(r"[A-Za-z0-9_./-]+", path)
                or any(part in {"", ".", ".."} for part in path.split("/"))
                or int(size) > 128 * 1024 * 1024):
            raise ValueError("데이터 파일 목록 형식 오류")
        files.append((path, int(size), sha))
    if not 1 <= len(files) <= 64 or len({row[0] for row in files}) != len(files):
        raise ValueError("데이터 파일 목록 누락 또는 중복")
    if sum(row[1] for row in files) > 128 * 1024 * 1024:
        raise ValueError("데이터 묶음 크기 초과")
    return files


def verify(folder, rows, manifest):
    path = folder / "DATA_MANIFEST.md"
    if path.is_symlink() or path.read_bytes() != manifest:
        raise ValueError("데이터 manifest 불일치")
    for relative, size, sha in rows:
        path = folder / relative
        if (any(parent.is_symlink() for parent in path.parents)
                or path.is_symlink() or not path.is_file()
                or path.stat().st_size != size or digest(path) != sha):
            raise ValueError("데이터 SHA 검증 실패: " + relative)


def prepare(root):
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise ValueError("HF_TOKEN 필요")
    opener = build_opener(SafeRedirect())

    def fetch(relative):
        return opener.open(Request(
            f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{PREFIX}/{relative}",
            headers={"Authorization": "Bearer " + token},
        ), timeout=60)

    with fetch("DATA_MANIFEST.md") as stream:
        manifest = stream.read(1024 * 1024 + 1)
    if len(manifest) > 1024 * 1024:
        raise ValueError("데이터 manifest 크기 초과")
    rows = manifest_files(manifest.decode("utf-8"))
    root = Path(root)
    destination = root / REVISION
    if destination.exists():
        if destination.is_symlink():
            raise ValueError("데이터 버전 링크 거부")
        verify(destination, rows, manifest)
        return
    temporary = Path(tempfile.mkdtemp(prefix=".route-", dir=root))
    try:
        (temporary / "DATA_MANIFEST.md").write_bytes(manifest)
        for relative, expected_size, _ in rows:
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            size = 0
            with fetch(relative) as stream, target.open("wb") as output:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > expected_size:
                        raise ValueError("데이터 파일 크기 초과")
                    output.write(chunk)
        verify(temporary, rows, manifest)
        # 파일·폴더는 Route의 비root 실행 계정도 읽을 수 있게 유지한다.
        for child in temporary.rglob("*"):
            child.chmod(0o755 if child.is_dir() else 0o444)
        temporary.chmod(0o755)
        if destination.exists():
            verify(destination, rows, manifest)
        else:
            temporary.rename(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


if __name__ == "__main__":
    try:
        prepare(sys.argv[1])
        print("Route 데이터 검증 완료")
        print("ROUTE_DATA_REVISION=" + REVISION)
    except Exception as error:
        # HTTP 오류 본문·헤더·토큰은 출력하지 않는다.
        print("Route 데이터 준비 실패: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1) from None
