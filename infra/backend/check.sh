#!/usr/bin/env bash
set -Eeuo pipefail

# 사용: check.sh <컨테이너 ID> <예상 이미지 ID> <Python 검사 이미지> [대기 초] [readiness|legacy]
# 새 배포는 readiness만 사용한다. legacy는 지정한 이전 이미지의 최초 복구에만 허용한다.
if [[ $# -lt 3 || $# -gt 5 ]]; then
    echo '컨테이너 ID·이미지 ID·검사 이미지가 필요합니다.' >&2
    exit 2
fi
container_id=$1
expected_image_id=$2
probe_image=$3
wait_seconds=${4:-120}
mode=${5:-readiness}
if [[ ! $wait_seconds =~ ^[1-9][0-9]*$ || ! $mode =~ ^(readiness|legacy)$ ]]; then
    echo '대기 시간 또는 검사 방식이 올바르지 않습니다.' >&2
    exit 2
fi
if [[ $mode == legacy ]]; then
    if [[ ! ${BACKEND_LEGACY_HEALTH_IMAGE_ID:-} =~ ^sha256:[0-9a-f]{64}$ \
        || $expected_image_id != "$BACKEND_LEGACY_HEALTH_IMAGE_ID" ]]; then
        echo 'legacy 검사는 명시한 이전 이미지 ID에서만 허용합니다.' >&2
        exit 2
    fi
fi

# 검사 이미지에 Python 표준 JSON/HTTP 도구가 있어야 한다. 응답 원문은 출력하지 않는다.
probe_code=$(cat <<'PY'
import json
import sys
import urllib.error
import urllib.request

try:
    if sys.argv[1] == 'readiness':
        with urllib.request.urlopen('http://127.0.0.1:8082/actuator/health/readiness', timeout=4) as r:
            data = r.read(4097)
            if r.status != 200 or len(data) > 4096 or json.loads(data) != {'status': 'UP'}:
                sys.exit(1)
    # 별도 관리 서버만 살아 있고 업무 HTTP 서버가 죽은 상태도 통과시키지 않는다.
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080/', timeout=2) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    valid = code == 404 if sys.argv[1] == 'legacy' else 200 <= code < 500
    sys.exit(0 if valid else 1)
except Exception:
    sys.exit(1)
PY
)
deadline=$((SECONDS + wait_seconds))
while (( SECONDS < deadline )); do
    actual_image_id=$(docker inspect --format '{{.Image}}' "$container_id") || exit 1
    [[ $actual_image_id == "$expected_image_id" ]] || exit 1
    running=$(docker inspect --format '{{.State.Running}}' "$container_id") || exit 1
    restarting=$(docker inspect --format '{{.State.Restarting}}' "$container_id") || exit 1
    [[ $running == true && $restarting == false ]] || exit 1
    started_at=$(docker inspect --format '{{.State.StartedAt}}' "$container_id") || exit 1
    [[ -n $started_at ]] || exit 1

    # 상태 API가 없는 최초 이전 이미지에만 기존 시작 로그 확인을 사용한다.
    ready=true
    if [[ $mode == legacy ]]; then
        startup_log=$(docker logs --tail 1000 "$container_id" 2>&1) || exit 1
        if ! grep -q 'Started BackendApplication' <<<"$startup_log" \
            || ! grep -q 'HikariPool.*Start completed' <<<"$startup_log"; then
            ready=false
        fi
    fi
    if [[ $ready == true ]] && docker run --rm --pull never --read-only --cap-drop ALL \
        --security-opt no-new-privileges --memory 64m --cpus 0.25 \
        --network "container:$container_id" "$probe_image" \
        python -c "$probe_code" "$mode" >/dev/null 2>&1; then
        # 검사 중 컨테이너가 교체·재시작되지 않았는지 다시 확인한다.
        [[ $(docker inspect --format '{{.Image}}' "$container_id") == "$expected_image_id" ]] || exit 1
        [[ $(docker inspect --format '{{.State.Running}}' "$container_id") == true ]] || exit 1
        [[ $(docker inspect --format '{{.State.Restarting}}' "$container_id") == false ]] || exit 1
        # 동일 이미지·동일 ID로 재시작한 경우도 이전 프로세스의 응답으로 통과시키지 않는다.
        [[ $(docker inspect --format '{{.State.StartedAt}}' "$container_id") == "$started_at" ]] || exit 1
        echo "이미지 일치·백엔드 HTTP·${mode} 검사 완료."
        exit 0
    fi
    sleep 3
done

echo "${wait_seconds}초 안에 백엔드 ${mode} 검사를 통과하지 못했습니다." >&2
exit 1
