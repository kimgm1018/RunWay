#!/usr/bin/env bash
set -Eeuo pipefail

# 수동 Route 검증 배포. 기존 이미지가 있으면 교체 실패 시 같은 이미지로 복구한다.
[[ $# == 2 && $1 =~ ^runway-route:[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ && -r $2 ]] || exit 2
image=$1
compose_file=$2
state=${ROUTE_DEPLOY_STATE_DIR:-/home/jenkins/agent/deploy-state/route}
mkdir -p "$state"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Route 배포가 이미 진행 중입니다.' >&2; exit 2; }
compose() { ROUTE_IMAGE=$1 docker compose -f "$compose_file" "${@:2}"; }
docker image inspect "$image" >/dev/null
docker image inspect python:3.12-alpine >/dev/null 2>&1 || docker pull python:3.12-alpine
compose "$image" config --quiet
previous=$(compose "$image" ps -a -q route)
[[ $previous != *$'\n'* ]] || exit 2
previous_image=
if [[ -n $previous ]]; then
    previous_image=$(docker inspect -f '{{.Image}}' "$previous")
    docker image tag "$previous_image" runway-route:previous
fi
expected=$(docker image inspect -f '{{.Id}}' "$image")

verify() {
    local selected=$1 identity=$2 container status started
    container=$(compose "$selected" ps -a -q route)
    [[ -n $container && $container != *$'\n'* ]] || return 1
    [[ $(docker inspect -f '{{.Image}}' "$container") == "$identity" ]] || return 1
    for _ in {1..45}; do
        [[ $(docker inspect -f '{{.State.Running}}' "$container") == true ]] || return 1
        status=$(docker inspect -f '{{.State.Health.Status}}' "$container")
        if [[ $status == healthy ]]; then
            started=$(docker inspect -f '{{.State.StartedAt}}' "$container")
            docker run --rm --network "container:$container" --memory 128m --cpus 0.25 \
                --read-only --cap-drop ALL --security-opt no-new-privileges:true \
                python:3.12-alpine python -c '
import json
from urllib.request import Request, urlopen
with urlopen("http://127.0.0.1:8000/internal/v1/ready", timeout=5) as response:
    assert response.status == 200 and json.load(response)["ready"] is True
request = Request("http://127.0.0.1:8000/internal/v1/routes/recommendations",
    data=json.dumps({"lat":35.1532,"lon":129.1186,"distance_km":5.0,"shape":"loop","seed":1}).encode(),
    headers={"Content-Type":"application/json"}, method="POST")
with urlopen(request, timeout=30) as response:
    assert response.status == 200
    routes = json.loads(response.read(2 * 1024 * 1024))["routes"]
    assert 1 <= len(routes) <= 3
    assert all(len(route["coords"]) >= 2 for route in routes)
print("Route ready·샘플 코스 생성 확인 완료")
'
            [[ $(docker inspect -f '{{.State.StartedAt}}' "$container") == "$started" ]] || return 1
            [[ $(docker inspect -f '{{.State.Running}}' "$container") == true ]] || return 1
            return
        fi
        sleep 4
    done
    return 1
}
rollback() {
    status=$?
    trap - EXIT INT TERM
    if [[ -n $previous_image ]]; then
        compose "$previous_image" up -d --no-deps --no-build --pull never route \
            && verify "$previous_image" "$previous_image" \
            || echo '이전 Route 복구 확인 실패: 수동 확인이 필요합니다.' >&2
    else
        failed=$(compose "$image" ps -a -q route)
        [[ -z $failed ]] || docker rm -f "$failed" >/dev/null
    fi
    exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose "$image" up -d --no-deps --no-build --pull never route
verify "$image" "$expected"
printf '%s\n' "$image" > "$state/current-image.tmp"
mv "$state/current-image.tmp" "$state/current-image"
trap - EXIT INT TERM
echo 'Route 배포 검증 완료'
