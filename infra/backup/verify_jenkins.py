#!/usr/bin/env python3
"""격리 Jenkins를 시작해 설정 로드·Credentials 복호화만 검사한다."""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

from backup import BackupError, digest, private_file, run


def unpack(archive, target, prefix):
    seen = set()
    with tarfile.open(archive) as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or member.name in seen or not (member.isfile() or member.isdir())
                    or not (member.name == prefix or member.name.startswith(prefix + "/"))):
                raise BackupError("Jenkins 복원 아카이브 형식이 올바르지 않습니다.")
            seen.add(member.name)
            destination = target.joinpath(*path.parts)
            if member.isdir():
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with source.extractfile(member) as reader, destination.open("xb") as writer:
                    shutil.copyfileobj(reader, writer)


def set_xml(tree, key, value):
    node = tree.getroot().find(key)
    if node is None:
        node = ET.SubElement(tree.getroot(), key)
    node.text = value


def verify(args):
    os.umask(0o077)
    private_file(args.key_file)
    manifests = sorted(args.directory.glob("jenkins-*.json"))
    if not manifests:
        raise BackupError("완료된 Jenkins 암호화 백업이 없습니다.")
    manifest = json.loads(manifests[-1].read_text(encoding="utf-8"))
    archive_name = manifest["archive"]
    recovery_name = manifest["recovery_archive"]
    if (not re.fullmatch(r"jenkins-\d{8}T\d{6}Z-[0-9a-f]{8}\.tar\.gpg", archive_name)
            or recovery_name != archive_name.removesuffix(".tar.gpg") + ".master-key.tar.gpg"):
        raise BackupError("Jenkins 복원 파일 이름이 올바르지 않습니다.")
    image = manifest["jenkins_image_id"]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise BackupError("Jenkins 이미지 ID가 올바르지 않습니다.")
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="runway-jenkins-restore-") as directory:
        temp = Path(directory)
        gpg = temp / "gpg"
        gpg.mkdir(mode=0o700)
        for encrypted, expected, filename, prefix in (
            (args.directory / archive_name, manifest["sha256"], "backup.tar", "jenkins"),
            (args.directory.parent / "recovery" / recovery_name, manifest["recovery_sha256"], "key.tar", "master.key"),
        ):
            if encrypted.is_symlink() or digest(encrypted) != expected:
                raise BackupError("Jenkins 백업 무결성 검사 실패")
            plain = temp / filename
            run(["gpg", "--homedir", str(gpg), "--batch", "--pinentry-mode", "loopback",
                 "--no-symkey-cache", "--passphrase-file", str(args.key_file),
                 "--output", str(plain), "--decrypt", str(encrypted)])
            unpack(plain, temp, prefix)
        home = temp / "jenkins"
        if (home / "secrets/master.key").exists():
            raise BackupError("일반 백업에 master.key가 들어 있습니다.")
        shutil.move(temp / "master.key", home / "secrets/master.key")
        # 운영 설정과 달리 모든 Job을 비활성화하고 executor·에이전트·백업 일정을 차단한다.
        config = ET.parse(home / "config.xml")
        set_xml(config, "numExecutors", "0")
        set_xml(config, "slaveAgentPort", "-1")
        config.write(home / "config.xml", encoding="utf-8", xml_declaration=True)
        jobs = list((home / "jobs").rglob("config.xml"))
        for path in jobs:
            tree = ET.parse(path)
            set_xml(tree, "disabled", "true")
            triggers = tree.getroot().find("triggers")
            if triggers is not None:
                triggers.clear()
            tree.write(path, encoding="utf-8", xml_declaration=True)
        node_count = len(list((home / "nodes").glob("*/config.xml")))
        for path in (home / "nodes").glob("*/config.xml"):
            ET.parse(path)
        if (home / "nodes").is_dir():
            shutil.rmtree(home / "nodes")
        thin = home / "org.jvnet.hudson.plugins.thinbackup.ThinBackupPluginImpl.xml"
        if thin.exists():
            tree = ET.parse(thin)
            set_xml(tree, "fullBackupSchedule", "")
            set_xml(tree, "diffBackupSchedule", "")
            tree.write(thin, encoding="utf-8", xml_declaration=True)
        init = home / "init.groovy.d"
        init.mkdir(mode=0o700, exist_ok=True)
        (init / "verify.groovy").write_text('''
import jenkins.model.Jenkins
import hudson.util.Secret
import groovy.json.JsonOutput
def j = Jenkins.get()
j.setNumExecutors(0)
j.setNodes([])
j.getAllItems(hudson.model.Job).each { job ->
    if (job.metaClass.respondsTo(job, 'setDisabled', Boolean.TYPE)) job.setDisabled(true)
}
int count = 0
boolean decrypted = true
j.rootDir.eachFileRecurse { file ->
    if (file.isFile() && file.name == 'credentials.xml') {
        def matcher = (file.getText('UTF-8') =~ /\\{AQAA[A-Za-z0-9+\\/=]+\\}/)
        while (matcher.find()) {
            count++
            if (Secret.decrypt(matcher.group()) == null) decrypted = false
        }
    }
}
new File(j.rootDir, 'restore-result.json').setText(JsonOutput.toJson([
    jobs: j.getAllItems(hudson.model.Job).size(),
    credentials: count, decrypted: decrypted && count > 0,
    executors: j.numExecutors, nodes: j.nodes.size()
]), 'UTF-8')
''', encoding="utf-8")
        for path in [home, *home.rglob("*")]:
            os.chown(path, 1000, 1000)
        # 임시 상위 폴더는 root 전용이다. Docker는 root가 mount를 준비한다.
        name = "runway-jenkins-restore-check-" + uuid.uuid4().hex
        created = False
        try:
            run(["docker", "create", "--name", name, "--network", "none", "--memory", "1g",
                 "--cpus", "1", "--label", "runway.jenkins-restore-check=true",
                 "--mount", f"type=bind,src={home},dst=/var/jenkins_home",
                 "-e", "JAVA_OPTS=-Xmx512m -Djenkins.install.runSetupWizard=false", image])
            created = True
            run(["docker", "start", name])
            print("외부 연결·포트·Docker 소켓 없는 임시 Jenkins 시작", flush=True)
            deadline = time.monotonic() + 240
            result_file = home / "restore-result.json"
            while not result_file.exists():
                if time.monotonic() >= deadline:
                    raise BackupError("격리 Jenkins 설정 로드 시간 초과")
                time.sleep(2)
            result = json.loads(result_file.read_text(encoding="utf-8"))
            if not (result["decrypted"] and result["jobs"] > 0 and result["executors"] == 0 and result["nodes"] == 0):
                raise BackupError("Jenkins 설정 또는 Credentials 복호화 검사 실패")
            print(f"Job {result['jobs']}개 로드·노드 설정 {node_count}개 구문·Credentials 복호화 통과")
        finally:
            if created:
                run(["docker", "rm", "--force", "--volumes", name])
    print(f"격리 Jenkins 복원 검증 완료 ({time.monotonic() - started:.1f}초)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--directory", type=Path,
                        default=Path("/home/ubuntu/runway/backups/automatic/jenkins"))
    args = parser.parse_args()
    try:
        verify(args)
    except BackupError as error:
        parser.exit(1, f"격리 Jenkins 복원 실패: {error}\n운영 Jenkins는 변경하지 않았습니다.\n")
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, tarfile.TarError, ET.ParseError):
        parser.exit(1, "격리 Jenkins 복원 실패: 기존 서비스는 유지됩니다. 도구·백업·리소스를 확인하세요.\n")


if __name__ == "__main__":
    main()
