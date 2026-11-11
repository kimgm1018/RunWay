"""Spring 경로 패턴을 검증하고 Nginx map과 수집기 목록으로 변환한다."""

import json
import re
from pathlib import Path

CATALOG_ROOT = Path("/catalog")

VARIABLE = re.compile(r"\{[A-Za-z][A-Za-z0-9_]*\}")
STATIC = re.compile(r"[A-Za-z0-9_./-]*")


def validate_routes(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 4096:
        raise ValueError("비어 있지 않은 API 경로 배열이 필요합니다.")
    routes = []
    for route in value:
        if not isinstance(route, str) or not route.startswith("/api/v1/") or len(route) > 256:
            raise ValueError("API 경로 패턴 형식 오류")
        if not STATIC.fullmatch(VARIABLE.sub("", route)) or "//" in route:
            raise ValueError("지원하지 않는 Spring 경로 문법")
        # 한 경로 구간 전체를 변수로 쓰는 현재 앱의 패턴만 지원한다.
        if any("{" in part and not VARIABLE.fullmatch(part) for part in route.split("/")):
            raise ValueError("지원하지 않는 경로 변수 형식")
        routes.append(route)
    if len(routes) != len(set(routes)):
        raise ValueError("중복 API 경로")
    return sorted(routes)


def read_routes(path):
    return validate_routes(json.loads(Path(path).read_text(encoding="utf-8")))


def nginx_map(routes):
    # 같은 길이일 때 고정 경로를 먼저 검사한다.
    ordered = sorted(validate_routes(routes), key=lambda p: (p.count("{"), -len(p), p))
    lines = ["# Spring이 등록한 API 경로에서 자동 생성. 직접 수정하지 않는다.", "default unknown;"]
    for route in ordered:
        regex = "/".join("[^/]+" if VARIABLE.fullmatch(part) else re.escape(part)
                         for part in route.split("/"))
        lines.append(f'~^{regex}$ "{route}";')
    return "\n".join(lines) + "\n"

def catalog_command():
    """CD가 사용하는 버전별 경로 목록을 한 번에 교체한다."""
    import base64
    import hashlib
    import os
    import sys

    root = CATALOG_ROOT
    active = root / "active"
    action = sys.argv[1]
    if action == "validate":
        validate_routes(json.loads(base64.b64decode(os.environ["ROUTES_BASE64"], validate=True)))
        return
    if action == "current":
        target = active.resolve(strict=True)
        if target.parent != root.resolve() or not re.fullmatch(r"[0-9a-f]{64}", target.name):
            raise ValueError("현재 경로 목록 링크 오류")
        read_routes(target / "api-routes.json")
        print(target.name)
        return
    if action == "install":
        payload = base64.b64decode(os.environ["ROUTES_BASE64"], validate=True)
        routes = validate_routes(json.loads(payload))
        data = json.dumps(routes, ensure_ascii=True, separators=(",", ":")).encode()
        rendered_map = nginx_map(routes)
        version = hashlib.sha256(data + b"\0" + rendered_map.encode("utf-8")).hexdigest()
        folder = root / version
        files = {"api-routes.json": data.decode(), "nginx.map": rendered_map}
        if folder.exists():
            if folder.is_symlink() or any((folder / name).read_text() != body for name, body in files.items()):
                raise ValueError("버전 폴더의 기존 내용이 다릅니다.")
        else:
            import shutil
            import tempfile
            temporary = Path(tempfile.mkdtemp(prefix=".routes-", dir=root))
            try:
                for name, body in files.items():
                    file = temporary / name
                    file.write_text(body, encoding="utf-8")
                    file.chmod(0o644)
                temporary.chmod(0o755)
                temporary.rename(folder)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
    elif action == "restore":
        version = os.environ["ROUTES_VERSION"]
        if not re.fullmatch(r"[0-9a-f]{64}", version):
            raise ValueError("복구 버전 형식 오류")
        read_routes(root / version / "api-routes.json")
    else:
        raise ValueError("지원하지 않는 동작")
    link = root / "active.next"
    link.unlink(missing_ok=True)
    link.symlink_to(version, target_is_directory=True)
    link.replace(active)


if __name__ == "__main__":
    catalog_command()
