"""고정 HF revision의 모델 4개를 검증해 새 폴더에 준비한다. 토큰은 저장·출력하지 않는다."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != "https":
            raise ValueError("HTTPS 다운로드만 허용")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urlsplit(req.full_url).netloc != urlsplit(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_manifest(path):
    return validate_manifest(json.loads(Path(path).read_text(encoding="utf-8")))


def validate_manifest(manifest):
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", manifest["repository"]):
        raise ValueError("모델 저장소 형식 오류")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest["revision"]):
        raise ValueError("고정 모델 revision 필요")
    names = set()
    for item in manifest["files"]:
        if (not re.fullmatch(r"[a-zA-Z0-9_.-]+", item["name"])
                or item["name"] in {".", ".."} or item["name"] in names
                or not re.fullmatch(r"[a-zA-Z0-9_./-]+", item["source"])
                or any(part in {".", "..", ""} for part in item["source"].split("/"))
                or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
            raise ValueError("모델 파일 목록 형식 오류")
        names.add(item["name"])
    if len(names) != 4:
        raise ValueError("모델 파일 4개 필요")
    return manifest


def verify(directory, manifest):
    for item in manifest["files"]:
        path = Path(directory) / item["name"]
        if path.is_symlink() or not path.is_file() or digest(path) != item["sha256"]:
            raise ValueError("모델 파일 누락 또는 SHA-256 불일치: " + item["name"])


def prepare(root, manifest, token, downloader=None):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    destination = root / manifest["revision"]
    if destination.exists():
        if destination.is_symlink():
            raise ValueError("모델 폴더 심볼릭 링크 거부")
        verify(destination, manifest)
        return destination
    if not token:
        raise ValueError("HF_TOKEN 설정 필요")
    opener = build_opener(SafeRedirect())

    def download(item, target):
        url = f'https://huggingface.co/{manifest["repository"]}/resolve/{manifest["revision"]}/{item["source"]}'
        request = Request(url, headers={"Authorization": "Bearer " + token})
        with opener.open(request, timeout=120) as response, target.open("wb") as stream:
            shutil.copyfileobj(response, stream)

    temporary = Path(tempfile.mkdtemp(prefix=".download-", dir=root))
    try:
        for item in manifest["files"]:
            target = temporary / item["name"]
            (downloader or download)(item, target)
            target.chmod(0o400)
        verify(temporary, manifest)
        temporary.chmod(0o500)
        # 파일 4개가 모두 맞을 때만 버전 폴더로 공개한다. 기존 버전은 덮어쓰지 않는다.
        if destination.exists():
            verify(destination, manifest)
        else:
            temporary.rename(destination)
        return destination
    finally:
        if temporary.exists():
            temporary.chmod(0o700)
            for child in temporary.iterdir():
                child.chmod(0o600)
            shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--settings-output", type=Path)
    parser.add_argument("--host-root", type=Path)
    args = parser.parse_args()
    try:
        if args.manifest:
            manifest = load_manifest(args.manifest)
        elif os.environ.get("AI_MODEL_MANIFEST"):
            manifest = validate_manifest(json.loads(os.environ["AI_MODEL_MANIFEST"]))
        else:
            manifest = load_manifest(Path(__file__).with_name("models.json"))
        prepare(args.root, manifest, os.environ.get("HF_TOKEN", ""))
        if args.settings_output:
            model_dir = (args.host_root or args.root) / manifest["revision"]
            sha = {item["name"]: item["sha256"] for item in manifest["files"]}
            settings = {
                "AI_MODEL_DIR": str(model_dir), "AI_MODEL_FILE": str(model_dir / "gru_final.pt"),
                "HR_MODEL_SHA256": sha["gru_final.pt"],
                "ODEV21_CHECKPOINT_PATH": "/models/ode/ode_epoch_020.pt",
                "ODEV21_CHECKPOINT_SHA256": sha["ode_epoch_020.pt"],
                "ODEV21_SUMMARY_STATS_PATH": "/models/ode/ode_summary_stats.json",
                "ODEV21_SUMMARY_STATS_SHA256": sha["ode_summary_stats.json"],
                "ODEV21_POPULATION_BUNDLE_PATH": "/models/ode/population_bundle_v2train_median.json",
                "ODEV21_POPULATION_BUNDLE_SHA256": sha["population_bundle_v2train_median.json"],
                "ODEV21_VARIANT": "ode_v21_base_epoch20_legacy27",
            }
            args.settings_output.write_text("".join(f"export {key}={shlex.quote(value)}\n" for key, value in settings.items()), encoding="utf-8")
    except Exception as exc:
        # HTTP 예외 본문·헤더·토큰·다운로드 URL은 출력하지 않는다.
        print("모델 준비 실패: " + type(exc).__name__, file=sys.stderr)
        return 1
    print("모델 4개 SHA-256 검증·준비 완료", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
