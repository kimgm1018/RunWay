#!/usr/bin/env bash
set -Eeuo pipefail

# 기존 배포 에이전트의 Docker 권한으로 전용 경로 목록 폴더만 갱신한다.
# 이 보조 컨테이너에는 Docker 소켓과 인증정보를 연결하지 않는다.
# 기존 배포 잠금을 상속한 CD에서만 호출한다. 직접 실행은 거부한다.
if [[ ${BACKEND_API_ROUTES_DEPLOY_LOCK_HELD:-} != true ]] || ! { : >&9; } 2>/dev/null; then
    echo 'API 경로 갱신은 deploy.sh의 배포 잠금 안에서만 실행합니다.' >&2
    exit 2
fi
flock -n 9 || exit 2

root=/var/lib/runway-monitoring/routes
image=python:3.12-alpine
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
module="$script_dir/../monitoring/route_catalog.py"
command=${1:?동작이 필요합니다}
case "$command" in
    current) ;;
    apply|validate) [[ $# == 2 && -r $2 ]] || exit 2 ;;
    restore) [[ $# == 2 && $2 =~ ^[0-9a-f]{64}$ ]] || exit 2 ;;
    *) exit 2 ;;
esac

catalog() {
    docker run --rm -i --network none --cap-drop ALL --security-opt no-new-privileges \
        --read-only --mount "type=bind,source=$root,target=/catalog" \
        -e "ROUTES_BASE64=${routes_data:-}" -e "ROUTES_VERSION=${restore_version:-}" \
        "$image" python - "$1" < "$module"
}

if [[ $command == current ]]; then
    catalog current
    exit
fi
if [[ $command == validate ]]; then
    routes_data=$(base64 < "$2" | tr -d '\r\n')
    catalog validate
    exit
fi
previous=$(catalog current)
if [[ $command == apply ]]; then
    routes_data=$(base64 < "$2" | tr -d '\r\n')
    catalog install
else
    restore_version=$2
    catalog restore
fi
if ! docker exec runway-nginx-1 nginx -t \
    || ! docker exec runway-nginx-1 nginx -s reload; then
    restore_version=$previous
    catalog restore
    docker exec runway-nginx-1 nginx -t && docker exec runway-nginx-1 nginx -s reload || true
    exit 1
fi
