"""보관 정책·민감 파일 보호·실패 시 기존 백업 유지 검증."""

import importlib.util
import json
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("backup", Path(__file__).parents[1] / "backup.py")
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)
RESTORE_SPEC = importlib.util.spec_from_file_location("verify_restore", Path(__file__).parents[1] / "verify_restore.py")
restore = importlib.util.module_from_spec(RESTORE_SPEC)
import sys
sys.modules["backup"] = backup
RESTORE_SPEC.loader.exec_module(restore)
JENKINS_SPEC = importlib.util.spec_from_file_location("jenkins_backup", Path(__file__).parents[1] / "jenkins_backup.py")
jenkins = importlib.util.module_from_spec(JENKINS_SPEC)
JENKINS_SPEC.loader.exec_module(jenkins)
VERIFY_JENKINS_SPEC = importlib.util.spec_from_file_location("verify_jenkins", Path(__file__).parents[1] / "verify_jenkins.py")
verify_jenkins = importlib.util.module_from_spec(VERIFY_JENKINS_SPEC)
VERIFY_JENKINS_SPEC.loader.exec_module(verify_jenkins)


class RetentionTest(unittest.TestCase):
    def complete(self, root, day):
        stem = f"data-202611{day:02}T040000Z-1234abcd"
        archive = root / (stem + ".tar.gpg")
        archive.write_bytes(b"test encrypted payload")
        manifest = root / (stem + ".json")
        manifest.write_text(json.dumps({"format": 1, "archive": archive.name,
                                        "sha256": backup.digest(archive)}), encoding="utf-8")
        return manifest, archive

    def test_keep_only_latest_successful_backups_preserving_manual_and_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = self.complete(root, 1)
            newer = self.complete(root, 2)
            latest = self.complete(root, 3)
            manual = root / "runway-before-master.dump"
            manual.write_bytes(b"manual")
            incomplete = root / "data-20261104T040000Z-1234abcd.tar.gpg"
            incomplete.write_bytes(b"incomplete")
            backup.retain(root, 2)
            self.assertTrue(all(not path.exists() for path in old))
            self.assertTrue(all(path.exists() for path in (*newer, *latest, manual, incomplete)))

    def test_corrupt_manifest_or_archive_never_counts_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            good = self.complete(root, 1)
            manifest, archive = self.complete(root, 2)
            archive.write_bytes(b"corrupted")
            backup.retain(root, 1)
            self.assertTrue(all(path.exists() for path in good))
            self.assertTrue(manifest.exists())

    def test_zero_retention_refuses_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            good = self.complete(root, 1)
            with self.assertRaises(backup.BackupError):
                backup.retain(root, 0)
            self.assertTrue(all(path.exists() for path in good))

    def test_tar_rejects_symlinks_and_devices(self):
        for member_type in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            member = tarfile.TarInfo("outside")
            member.type = member_type
            with self.assertRaises(backup.BackupError):
                backup.regular_member(member)

    def test_subprocess_failure_hides_stderr(self):
        with patch.object(backup.subprocess, "run") as execute:
            execute.return_value.returncode = 1
            execute.return_value.stderr = b"sensitive database value"
            with self.assertRaises(backup.BackupError) as error:
                backup.run(["pg_dump"])
            self.assertNotIn("sensitive", str(error.exception))

    def test_restore_rejects_path_traversal_links_and_duplicate_files(self):
        for names, link in [(["../outside"], False), (["images/link"], True),
                            (["metadata.json", "metadata.json"], False)]:
            with self.subTest(names=names, link=link), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "bad.tar"
                with tarfile.open(archive, "w") as target:
                    for name in names:
                        member = tarfile.TarInfo(name)
                        member.type = tarfile.SYMTYPE if link else tarfile.REGTYPE
                        member.linkname = "/etc/passwd" if link else ""
                        target.addfile(member, None if link else io.BytesIO(b""))
                with self.assertRaises(backup.BackupError):
                    restore.extract(archive, root / "output")

    def test_restore_requires_database_roles_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "missing.tar"
            with tarfile.open(archive, "w"):
                pass
            with self.assertRaises(backup.BackupError):
                restore.extract(archive, root / "output")

    def test_jenkins_collects_only_completed_full_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            done = root / "FULL-2026-11-02_16-30"
            done.mkdir()
            (done / "backup-completed.info").touch()
            (root / "FULL-2026-11-03_16-30").mkdir()
            diff = root / "DIFF-2026-11-04_16-30"
            diff.mkdir()
            (diff / "backup-completed.info").touch()
            self.assertEqual(jenkins.completed_snapshots(root), [done])

    def test_jenkins_snapshot_change_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.xml"
            config.write_text("example", encoding="utf-8")
            before = jenkins.fingerprint(root)
            config.write_text("changed example", encoding="utf-8")
            self.assertNotEqual(before, jenkins.fingerprint(root))

    def test_jenkins_deduplication_requires_recovery_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "jenkins-20261102T040000Z-1234abcd.tar.gpg"
            archive.write_bytes(b"encrypted example")
            (root / "jenkins-20261102T040000Z-1234abcd.json").write_text(json.dumps({
                "archive": archive.name, "source": "FULL-2026-11-02_16-30",
                "sha256": backup.digest(archive), "recovery_archive": "missing.gpg",
                "recovery_sha256": "not-a-real-hash"}), encoding="utf-8")
            self.assertFalse(jenkins.already_saved(root, Path("FULL-2026-11-02_16-30")))

    def test_jenkins_restore_rejects_wrong_root_and_traversal(self):
        for name in ("jenkins/../../outside", "master.key", "/jenkins/config.xml", "jenkins\\outside"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "bad.tar"
                with tarfile.open(archive, "w") as target:
                    target.addfile(tarfile.TarInfo(name), io.BytesIO(b""))
                with self.assertRaises(backup.BackupError):
                    verify_jenkins.unpack(archive, root / "output", "jenkins")

    def test_jenkins_restore_changes_only_requested_xml_fields(self):
        tree = verify_jenkins.ET.ElementTree(verify_jenkins.ET.fromstring(
            "<jenkins><numExecutors>2</numExecutors><useSecurity>true</useSecurity></jenkins>"))
        verify_jenkins.set_xml(tree, "numExecutors", "0")
        verify_jenkins.set_xml(tree, "slaveAgentPort", "-1")
        self.assertEqual(tree.getroot().findtext("numExecutors"), "0")
        self.assertEqual(tree.getroot().findtext("slaveAgentPort"), "-1")
        self.assertEqual(tree.getroot().findtext("useSecurity"), "true")

    def test_jenkins_same_minute_snapshot_refresh_is_not_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "jenkins"
            root.mkdir()
            recovery_dir = base / "recovery"
            recovery_dir.mkdir()
            snapshot = base / "FULL-2026-11-02_16-30"
            snapshot.mkdir()
            marker = snapshot / "backup-completed.info"
            marker.touch()
            archive = root / "jenkins-20261102T040000Z-1234abcd.tar.gpg"
            archive.write_bytes(b"example encrypted backup")
            recovery = recovery_dir / "jenkins-20261102T040000Z-1234abcd.master-key.tar.gpg"
            recovery.write_bytes(b"example encrypted recovery")
            record = {"archive": archive.name, "sha256": backup.digest(archive),
                      "source": snapshot.name, "source_completed_ns": marker.stat().st_mtime_ns,
                      "recovery_archive": recovery.name, "recovery_sha256": backup.digest(recovery)}
            (root / "jenkins-20261102T040000Z-1234abcd.json").write_text(json.dumps(record), encoding="utf-8")
            self.assertTrue(jenkins.already_saved(root, snapshot))
            import os
            changed = marker.stat().st_mtime_ns + 1000000000
            os.utime(marker, ns=(changed, changed))
            self.assertFalse(jenkins.already_saved(root, snapshot))


if __name__ == "__main__":
    unittest.main()
