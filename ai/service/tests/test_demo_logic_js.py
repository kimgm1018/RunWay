import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.demo.buffer import GROUP_KEY_OFFSET, WINDOW_SEC

SERVICE = Path(__file__).resolve().parent.parent
LOGIC_JS = SERVICE / "app" / "static" / "demo" / "js" / "logic.js"
JS_TEST = SERVICE / "tests" / "js" / "logic.test.js"


def test_page_trace_window_matches_server_buffer():
    # 데모 화면과 서버 버퍼가 같은 10분 창을 쓰는지 확인한다
    match = re.search(r"var TRACE_WINDOW_SEC = (\d+(?:\.\d+)?);", LOGIC_JS.read_text(encoding="utf-8"))
    assert match, "logic.js에 TRACE_WINDOW_SEC 선언이 없다"
    assert float(match.group(1)) == WINDOW_SEC


def test_demo_logic_js_unit_tests():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node가 없어 데모 JS 단위 테스트를 건너뛴다")
    result = subprocess.run([node, "--test", str(JS_TEST)], cwd=SERVICE, capture_output=True,
                            text=True, encoding="utf-8", timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


def test_page_group_key_matches_server():
    # 콘솔의 ?group= 주소가 서버의 그룹 스트림 키와 같은 값을 쓰는지 확인한다
    match = re.search(r"var GROUP_KEY_OFFSET = (\d+);", LOGIC_JS.read_text(encoding="utf-8"))
    assert match, "logic.js에 GROUP_KEY_OFFSET 선언이 없다"
    assert int(match.group(1)) == GROUP_KEY_OFFSET
