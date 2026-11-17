"""시연 콘솔 청중용 알림(페이스 변경 카드·뒤처짐) JS 단위 테스트(S15P31E105-909)."""
import shutil
import subprocess
from pathlib import Path

import pytest

SERVICE = Path(__file__).resolve().parent.parent
JS_TEST = SERVICE / "tests" / "js" / "alerts.test.js"


def test_demo_alerts_js_unit_tests():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node가 없어 데모 JS 단위 테스트를 건너뛴다")
    result = subprocess.run([node, "--test", str(JS_TEST)], cwd=SERVICE, capture_output=True,
                            text=True, encoding="utf-8", timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
