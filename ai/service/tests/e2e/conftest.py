import pytest
playwright = pytest.importorskip("playwright")

import socket
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from contextlib import contextmanager

import uvicorn
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(ROOT))

from app.main import create_app
from demo_fakes import FakeModel5, FakePolicy, demo_settings


@pytest.fixture
def live_server(tmp_path):
    settings = demo_settings(tmp_path)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), demo_loader=lambda: settings)
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True); thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True; thread.join(timeout=5)


@pytest.fixture
def page():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        if not Path(p.chromium.executable_path).is_file():
            pytest.skip("Playwright Chromium executable is not installed")
        browser = p.chromium.launch()
        page = browser.new_page()
        yield page
        browser.close()
