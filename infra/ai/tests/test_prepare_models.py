"""실제 모델·인증정보 없이 모델 묶음의 실패 차단과 토큰 전달 경계를 검사한다."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_models", ROOT / "prepare_models.py")
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


class PrepareModelsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = copy.deepcopy(models.load_manifest(ROOT / "models.json"))
        for entry in self.manifest["files"]:
            entry["sha256"] = hashlib.sha256(entry["name"].encode()).hexdigest()

    def download(self, item, target):
        target.write_bytes(item["name"].encode())

    def test_complete_bundle_is_published_and_reused_without_token(self):
        target = models.prepare(self.root, self.manifest, "fake-token", self.download)
        models.verify(target, self.manifest)
        self.assertEqual(models.prepare(self.root, self.manifest, ""), target)
        # Windows에서도 테스트 임시 폴더를 정리할 수 있게 읽기 전용 파일을 해제한다.
        target.chmod(0o700)
        for item in target.iterdir():
            item.chmod(0o600)

    def test_bad_hash_never_publishes_partial_bundle(self):
        def broken(item, target):
            target.write_bytes(b"wrong")
        with self.assertRaises(ValueError):
            models.prepare(self.root, self.manifest, "fake-token", broken)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_download_error_does_not_leave_partial_bundle(self):
        def broken(item, target):
            raise OSError("download failed")
        with self.assertRaises(OSError):
            models.prepare(self.root, self.manifest, "fake-token", broken)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_missing_token_fails_before_download(self):
        with self.assertRaises(ValueError):
            models.prepare(self.root, self.manifest, "", self.download)

    def test_cross_host_redirect_drops_authorization(self):
        request = Request("https://huggingface.co/model", headers={"Authorization": "Bearer fake"})
        redirected = models.SafeRedirect().redirect_request(
            request, None, 302, "Found", {}, "https://cdn.example.org/blob")
        self.assertFalse(redirected.has_header("Authorization"))

    def test_http_redirect_is_rejected(self):
        with self.assertRaises(ValueError):
            models.SafeRedirect().redirect_request(
                Request("https://huggingface.co/model"), None, 302, "Found", {}, "http://example.org/blob")
