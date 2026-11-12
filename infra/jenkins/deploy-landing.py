import argparse
import hashlib
import os
import sys
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen


def validate(html):
    text = html.decode("utf-8")
    if not text.lstrip().lower().startswith("<!doctype html>") or "</html>" not in text.lower():
        raise ValueError("유효한 랜딩 HTML이 필요합니다.")


def replace_html(target, html):
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".index.html.", delete=False) as handle:
        candidate = Path(handle.name)
        try:
            handle.write(html)
            handle.close()
            candidate.chmod(0o644)
            os.replace(candidate, target)
        finally:
            candidate.unlink(missing_ok=True)


def verify(html):
    digest = hashlib.sha256(html).hexdigest()
    request = Request(f"https://k15e105.p.ssafy.io/?landing={digest}", headers={"Cache-Control": "no-cache"})
    with urlopen(request, timeout=15) as response:
        if response.status != 200 or response.read(len(html) + 1) != html:
            raise ValueError("공개 랜딩 응답이 배포 파일과 일치하지 않습니다.")


def deploy(target, html, check):
    previous = target.read_bytes()
    if previous == html:
        check(html)
        return

    replace_html(target, html)
    try:
        check(html)
    except Exception:
        replace_html(target, previous)
        print("공개 응답 확인 실패로 이전 HTML을 복구했습니다.", file=sys.stderr)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = sys.stdin.buffer.read()
    validate(payload)
    if not args.check:
        deploy(Path("/landing/index.html"), payload, verify)
    print("랜딩 HTML 검증 완료")
