"""서버 백업 내보내기·PC 다운로드의 경로/무결성/실패 보존 테스트."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import export_backup as exporter
import download_backups as client


class DownloadTest(unittest.TestCase):
    def test_export_rejects_arbitrary_paths(self):
        for name in ("../credentials.xml", "/root/runway-backup-key", "data-../../etc/passwd", "credentials.xml"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                exporter.locate(name)

    def test_client_rejects_path_traversal(self):
        for name in ("../example", "/tmp/example", "data-example.tar.gpg", "jenkins\\example"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                client.valid_name(name)

    def test_latest_ignores_corrupt_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "data"
            folder.mkdir()
            name = "data-20261102T040000Z-1234abcd.tar.gpg"
            (folder/name).write_bytes(b"example encrypted bytes")
            (folder/"data-20261102T040000Z-1234abcd.json").write_text(json.dumps({
                "format": 1, "archive": name, "sha256": "invalid"
            }), encoding="utf-8")
            with patch.object(exporter, "ROOT", root):
                self.assertEqual(exporter.latest(), [])

    def test_download_failure_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = "data-20261102T040000Z-1234abcd.tar.gpg"
            path = root / name
            path.write_bytes(b"previous backup")
            args = SimpleNamespace(identity=Path("unused-identity"), host="unused-host")
            with patch.object(client.subprocess, "run", return_value=SimpleNamespace(returncode=1)):
                with self.assertRaises(ValueError):
                    client.fetch(args, name, path, expected="not-the-existing-hash")
            self.assertEqual(path.read_bytes(), b"previous backup")
            self.assertEqual(list(root.glob("*.partial")), [])

    def test_verified_existing_file_skips_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = "data-20261102T040000Z-1234abcd.tar.gpg"
            path = root / name
            path.write_bytes(b"example encrypted bytes")
            with patch.object(client.subprocess, "run") as network:
                client.fetch(None, name, path, expected=client.digest(path))
                network.assert_not_called()

    def test_recovery_key_mismatch_never_overwrites_existing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "runway-backup-key"
            path.write_bytes(b"preserved example key")
            args = SimpleNamespace(identity=Path("unused-identity"), host="unused-host")
            def fake_network(command, **options):
                options["stdout"].write(b"1" * 64 + b"\n")
                return SimpleNamespace(returncode=0)
            with patch.object(client.subprocess, "run", side_effect=fake_network):
                with self.assertRaises(ValueError):
                    client.fetch(args, "runway-backup-key", path, key=True)
            self.assertEqual(path.read_bytes(), b"preserved example key")


if __name__ == "__main__":
    unittest.main()
