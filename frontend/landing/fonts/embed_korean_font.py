"""S15P31E105-868: 랜딩 index.html의 한글 글꼴(G마켓 산스)을 페이지에 쓰인 글자만 남긴 woff2로 넣는다.

랜딩은 index.html 한 파일만 배포되므로(infra/README.md 소개 랜딩) 글꼴도 HTML 안에 있어야 한다.
외부 CDN 글꼴을 쓰면 불러오지 못한 기기에서 기본 글꼴로 바뀌어 글자 간격·줄바꿈이 달라진다.

index.html의 한글 문구를 고치거나 더하면, 새 글자가 빠지지 않도록 이 스크립트를 다시 실행한다.
G마켓 산스 TTF(GmarketSansTTFMedium.ttf, GmarketSansTTFBold.ttf)가 있는 폴더를 넘긴다.
글꼴 원본은 저장소에 넣지 않는다(G마켓 무료 배포 글꼴, https://corp.gmarket.com/fonts).
    python frontend/landing/fonts/embed_korean_font.py <G마켓 산스 TTF 폴더>

필요 패키지: fonttools, brotli (woff2 압축)
"""
import base64
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

INDEX = Path(__file__).resolve().parent.parent / "index.html"
BEGIN = "/* KOREAN_FONT:BEGIN */"
END = "/* KOREAN_FONT:END */"
# CSS 굵기 400·500은 Medium, 600~800은 Bold로 맞춰진다(CSS 글꼴 굵기 대체 규칙)
WEIGHTS = {500: "GmarketSansTTFMedium.ttf", 700: "GmarketSansTTFBold.ttf"}


def page_text(html: str) -> str:
    """글꼴 자리를 뺀 페이지 글자 + 영문·숫자·기호 전체(문구 사이 영문도 같은 글꼴로)."""
    start, stop = html.find(BEGIN), html.find(END)
    rest = html[:start] + html[stop + len(END):]
    return "".join(sorted(set(rest) | {chr(c) for c in range(0x20, 0x7F)}))


def woff2(path: Path, text: str) -> tuple[bytes, int]:
    font = TTFont(path)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(text=text)
    sub.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue(), len(font.getGlyphOrder())


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 1
    src = Path(sys.argv[1])
    html = INDEX.read_text(encoding="utf-8")
    start, stop = html.find(BEGIN), html.find(END)
    if start < 0 or stop < start:
        print("index.html에서 KOREAN_FONT 자리를 찾지 못했습니다.", file=sys.stderr)
        return 1
    indent = html[html.rfind("\n", 0, start) + 1:start]
    text = page_text(html)
    lines = []
    for weight, name in WEIGHTS.items():
        path = src / name
        if not path.is_file():
            print(f"{name}이 {src}에 없습니다.", file=sys.stderr)
            return 1
        data, glyphs = woff2(path, text)
        lines.append(f'{indent}@font-face {{ font-family: "GmarketSans"; font-weight: {weight}; font-display: swap;')
        lines.append(f'{indent}  src: url("data:font/woff2;base64,{base64.b64encode(data).decode("ascii")}") format("woff2"); }}')
        print(f"{name}: 글리프 {glyphs}개, {len(data) // 1024} KiB")
    body = BEGIN + "\n" + "\n".join(lines) + "\n" + indent + END
    new = html[:start] + body + html[stop + len(END):]
    INDEX.write_bytes(new.encode("utf-8"))
    print(f"넣음 → {INDEX.name} ({len(new.encode('utf-8')) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
