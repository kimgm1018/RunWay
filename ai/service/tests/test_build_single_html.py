import json
import shutil
from pathlib import Path

from tools.build_single_html import build

STATIC = Path(__file__).resolve().parent.parent / "app" / "static" / "demo"


def test_single_html_inlines_assets_and_recordings(tmp_path):
    static = tmp_path / "demo"
    shutil.copytree(STATIC, static, ignore=shutil.ignore_patterns("recordings"))
    (static / "recordings").mkdir()
    rec = {"id": "r1", "label": "합성 </script> 기록", "modelLabel": "가짜 예측기", "traces": []}
    (static / "recordings" / "r1.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    html = build(static, ["r1"], tmp_path / "one.html").read_text(encoding="utf-8")
    assert 'src="js/' not in html and 'href="style.css"' not in html          # 외부 파일을 읽지 않는다
    assert "window.RunwayDemoInlineRecordings" in html and "가짜 예측기" in html
    assert html.count("<script>") == 5 and html.lower().count("</script") == 5    # 기록 안의 </script>는 막는다
