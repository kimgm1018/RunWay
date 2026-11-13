"""S15P31E105-770: team/member-*.webp를 랜딩 index.html의 TEAM_PHOTOS 자리에 base64로 넣는다.

랜딩은 index.html 한 파일만 배포되므로(infra/README.md 소개 랜딩) 사진도 HTML 안에 있어야 한다.
사진을 바꾸거나 더하면 team/ 폴더의 webp만 고치고 이 스크립트를 다시 실행한다.
    python frontend/landing/team/embed_photos.py
"""
import base64
import re
import sys
from pathlib import Path

TEAM_DIR = Path(__file__).resolve().parent
INDEX = TEAM_DIR.parent / "index.html"
BEGIN = "/* TEAM_PHOTOS:BEGIN */"
END = "/* TEAM_PHOTOS:END */"


def main() -> int:
    html = INDEX.read_text(encoding="utf-8")
    start, stop = html.find(BEGIN), html.find(END)
    if start < 0 or stop < start:
        print("index.html에서 TEAM_PHOTOS 자리를 찾지 못했습니다.", file=sys.stderr)
        return 1
    indent = html[html.rfind("\n", 0, start) + 1:start]
    lines = []
    for path in sorted(TEAM_DIR.glob("member-*.webp")):
        if not re.fullmatch(r"member-\d{2}\.webp", path.name):
            continue
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        lines.append(f"{indent}'{path.stem}': 'data:image/webp;base64,{data}',")
    body = BEGIN + "\n" + "\n".join(lines) + ("\n" if lines else "") + indent + END
    new = html[:start] + body + html[stop + len(END):]
    INDEX.write_bytes(new.encode("utf-8"))
    print(f"{len(lines)}장 넣음 → {INDEX.name} ({len(new.encode('utf-8')) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
