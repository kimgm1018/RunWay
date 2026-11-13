"""정적 콘솔과 재생 기록을 HTML 한 파일로 묶는다.

Jupyter /files/처럼 HTML을 sandbox로 열어 옆 파일(CSS·JS·기록)을 못 읽는 곳에서도 그대로 열린다.
"""
import argparse
import json
import re
import sys
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent / "app" / "static" / "demo"
SCRIPTS = ("js/logic.js", "js/render.js", "js/stream.js", "js/standings.js", "js/livemap.js", "js/zoom.js", "js/main.js")


def _safe_script(text: str) -> str:
    # 본문 안의 </script가 태그를 닫지 않게 한다
    return re.sub(r"</(script)", r"<\\/\1", text, flags=re.IGNORECASE)


def build(static_dir: Path, recording_ids: list[str], out: Path) -> Path:
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    css = (static_dir / "style.css").read_text(encoding="utf-8")
    # 캐시 무효화용 ?v=… 가 붙어 있어도 같은 자리를 바꾼다
    html = re.sub(r'<link rel="stylesheet" href="style\.css(\?v=[\w.-]+)?">', lambda _: "<style>\n" + css + "\n</style>", html)
    html = re.sub(r'\s*<script defer src="js/[a-z]+\.js(\?v=[\w.-]+)?"></script>', "", html)
    recordings = [json.loads((static_dir / "recordings" / f"{rid}.json").read_text(encoding="utf-8"))
                  for rid in recording_ids]
    data = "window.RunwayDemoInlineRecordings = " + json.dumps(recordings, ensure_ascii=False, separators=(",", ":")) + ";"
    sources = [data] + [(static_dir / name).read_text(encoding="utf-8") for name in SCRIPTS]
    scripts = "".join("<script>\n" + _safe_script(src) + "\n</script>\n" for src in sources)
    out = Path(out)
    out.write_text(html.replace("</body>", scripts + "</body>"), encoding="utf-8")
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", required=True, dest="ids", help="recordings/<id>.json, 여러 번 줄 수 있다")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--static-dir", type=Path, default=STATIC_DIR)
    args = parser.parse_args(argv)
    try:
        path = build(args.static_dir, args.ids, args.out)
    except (OSError, ValueError) as exc:
        print(f"한 파일 콘솔 만들기 실패: {exc}", file=sys.stderr)
        return 1
    print(f"한 파일 콘솔: {path} ({path.stat().st_size // 1024} KB, 기록 {len(args.ids)}개)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
