"""Route 데이터 묶음의 SHA 검증·재사용·잘못된 경로 거부를 확인한다."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "ai"))
spec = importlib.util.spec_from_file_location("route_data", ROOT / "prepare_data.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BundleTests(unittest.TestCase):
    def test_verified_bundle_is_published_and_cached_bundle_is_rechecked(self):
        content = b"verified-route-data"
        sha = hashlib.sha256(content).hexdigest()
        manifest = f"| `data/example.bin` | {len(content)} | `{sha}` | source |\n".encode()
        calls = []
        class Opener:
            def open(self, request, timeout):
                relative = request.full_url.split("/route_data_v2/", 1)[1]
                calls.append(relative)
                return io.BytesIO(manifest if relative == "DATA_MANIFEST.md" else content)
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"HF_TOKEN": "test-only"}), patch.object(module, "build_opener", return_value=Opener()):
            module.prepare(directory)
            destination = Path(directory) / module.REVISION
            self.assertEqual((destination / "data/example.bin").read_bytes(), content)
            calls.clear()
            module.prepare(directory)
            self.assertEqual(calls, ["DATA_MANIFEST.md"])
            target = destination / "data/example.bin"
            target.chmod(0o600)
            target.write_bytes(b"modified")
            with self.assertRaises(ValueError):
                module.prepare(directory)
            # Windows의 읽기 전용 플래그도 테스트 정리 전에 해제한다.
            (destination / "DATA_MANIFEST.md").chmod(0o600)

    def test_manifest_rejects_traversal_duplicates_and_oversized_data(self):
        sha = "a" * 64
        row = lambda name, size=1: f"| `{name}` | {size} | `{sha}` | source |\n"
        for text in (row("../secret"), row("/absolute"), row("data/file") * 2, row("data/file", 129 * 1024 * 1024), "empty"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                module.manifest_files(text)

    def test_failed_download_does_not_publish_partial_revision(self):
        sha = "a" * 64
        manifest = f"| `data/file` | 3 | `{sha}` | source |\n".encode()
        class Opener:
            def open(self, request, timeout):
                if request.full_url.endswith("DATA_MANIFEST.md"):
                    return io.BytesIO(manifest)
                raise HTTPError(request.full_url, 403, "denied", {}, None)
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"HF_TOKEN": "test-only"}), patch.object(module, "build_opener", return_value=Opener()):
            with self.assertRaises(HTTPError):
                module.prepare(directory)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
