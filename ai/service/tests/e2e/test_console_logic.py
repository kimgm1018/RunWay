import pytest
pytest.importorskip("playwright")


def test_classic_logic_exposed(page, live_server):
    page.goto(live_server + "/demo/?mode=replay")
    assert page.evaluate("typeof window.RunwayDemoLogic") == "object"
    assert page.evaluate("window.RunwayDemoLogic.backoffMs(2)") == 5000
