"""Publish the checked APKs from Jenkins' last successful builds."""

import hashlib
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

JOBS = Path("/var/lib/docker/volumes/runway_jenkins_home/_data/jobs")
DOWNLOADS = Path("/home/ubuntu/runway/frontend/landing/downloads")


def publish(builds: Path, downloads: Path, filename: str) -> None:
    permalinks = builds / "permalinks"
    if not permalinks.exists():
        return
    match = re.search(r"^lastSuccessfulBuild ([1-9][0-9]*)$", permalinks.read_text(), re.MULTILINE)
    if match is None:
        return
    number = int(match[1])
    build = builds / str(number)
    if build.resolve() != builds.resolve() / str(number):
        raise ValueError("Unexpected Jenkins build directory")
    archive = build / "archive" / "artifacts"
    apk = archive / filename
    if not apk.is_file():
        return

    build_xml = build / "build.xml"
    metadata_file = archive / "build-info.txt"
    checksum_file = archive / f"{filename}.sha256"
    for path in (apk, build_xml, metadata_file, checksum_file):
        expected = builds.resolve() / path.relative_to(builds)
        if path.resolve() != expected or not path.is_file():
            raise ValueError("Unexpected Jenkins artifact path")

    if ET.parse(build_xml).getroot().findtext("result") != "SUCCESS":
        raise ValueError("Jenkins build did not succeed")
    metadata = dict(line.split("=", 1) for line in metadata_file.read_text().splitlines())
    if (metadata.get("branch"), metadata.get("build"), metadata.get("type")) != ("master", str(number), "release"):
        raise ValueError("Unexpected APK build metadata")
    checksum = checksum_file.read_text().split()
    if len(checksum) != 2 or not re.fullmatch(r"[0-9a-f]{64}", checksum[0]):
        raise ValueError("Invalid APK checksum")

    target = downloads / filename
    stamp = downloads / f".{filename}.published-build"
    if stamp.is_file() and target.is_file() and int(stamp.read_text()) >= number:
        return
    with tempfile.NamedTemporaryFile(dir=downloads, prefix=".runway-", delete=False) as temporary:
        candidate = Path(temporary.name)
        try:
            with apk.open("rb") as source:
                shutil.copyfileobj(source, temporary)
            temporary.close()
            with candidate.open("rb") as source:
                actual = hashlib.file_digest(source, "sha256").hexdigest()
            if actual != checksum[0] or candidate.stat().st_size == 0:
                raise ValueError("APK checksum verification failed")
            candidate.chmod(0o644)
            os.replace(candidate, target)
            next_stamp = stamp.with_name(f"{stamp.name}.next")
            next_stamp.write_text(f"{number}\n")
            os.replace(next_stamp, stamp)
        finally:
            candidate.unlink(missing_ok=True)
    print(f"Published {filename} from build {number}")


if __name__ == "__main__":
    failed = False
    for job, filename in (("runway-mobile-apk", "runway.apk"), ("runway-watch-apk", "runway-watch.apk")):
        try:
            publish(JOBS / job / "builds", DOWNLOADS, filename)
        except (OSError, ValueError, ET.ParseError) as error:
            print(f"{job}: publish failed ({type(error).__name__})", file=sys.stderr)
            failed = True
    sys.exit(1 if failed else 0)
