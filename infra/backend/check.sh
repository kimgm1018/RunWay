#!/usr/bin/env bash
set -Eeuo pipefail

# 사용: bash check.sh <컨테이너 ID> <예상 이미지 ID> <검사 이미지> [대기 초]
# 현재는 전용 readiness API가 없어 시작 로그·DB 연결 로그·HTTP 응답을 함께 확인한다.
# 이 검사는 기본 기동 확인이며, 서비스 전체 기능이나 지속적인 DB 상태를 보장하지 않는다.
# deploy.sh가 호출하며, 검사 통과는 종료 코드 0, 실패는 1로 전달한다.
if [[ $# -lt 3 || $# -gt 4 ]]; then
    echo 'check.sh에 컨테이너 ID·이미지 ID·검사 이미지가 필요합니다.' >&2
    exit 2
fi
container_id=$1
expected_image_id=$2
probe_image=$3
wait_seconds=${4:-120}
if [[ ! $wait_seconds =~ ^[1-9][0-9]*$ ]]; then
    echo '대기 시간은 양의 정수여야 합니다.' >&2
    exit 2
fi
# 서버가 시작될 시간을 주기 위해 기본 120초 동안 반복해서 확인한다.
deadline=$((SECONDS + wait_seconds))

while (( SECONDS < deadline )); do
    # 원하는 이미지가 실제로 실행 중인지 먼저 확인한다. 다르면 즉시 실패한다.
    actual_image_id=$(docker inspect --format '{{.Image}}' "$container_id") || exit 1
    [[ $actual_image_id == "$expected_image_id" ]] || exit 1
    running=$(docker inspect --format '{{.State.Running}}' "$container_id") || exit 1
    # 중단·재시작 중인 컨테이너는 이전 시작 로그가 있어도 정상으로 보지 않는다.
    [[ $running == true ]] || exit 1
    restarting=$(docker inspect --format '{{.State.Restarting}}' "$container_id") || exit 1
    [[ $restarting == false ]] || exit 1

    # Spring 시작 완료와 DB 초기 연결 완료가 모두 로그에 있는지 확인한다.
    # 로그는 내부 검사에만 사용한다. 원문을 Jenkins 로그에 다시 출력하지 않는다.
    if [[ $running == true ]]; then
        startup_log=$(docker logs --tail 1000 "$container_id" 2>&1) || exit 1
        if grep -q 'Started BackendApplication' <<<"$startup_log" \
            && grep -q 'HikariPool.*Start completed' <<<"$startup_log"; then
            # 임시 curl 컨테이너에서 백엔드 HTTP 응답을 확인하고 검사 후 제거한다.
            # 백엔드의 네트워크를 공유하므로 아래 127.0.0.1은 백엔드를 가리킨다.
            http_code=$(docker run --rm --pull never --read-only --cap-drop ALL \
                --security-opt no-new-privileges \
                --network "container:$container_id" "$probe_image" \
                --silent --connect-timeout 2 --max-time 4 \
                --output /dev/null --write-out '%{http_code}' \
                http://127.0.0.1:8080/) || http_code=000
            # 현재 '/' API가 없는 build-22의 응답을 기준으로 한다.
            # readiness API가 추가되면 해당 경로의 200/UP 검사로 교체해야 한다.
            if [[ $http_code == 404 ]]; then
                echo '이미지 일치·DB 초기 연결·Spring 시작·HTTP 응답 확인 완료.'
                exit 0
            fi
        fi
    fi
    # 아직 시작 로그나 예상 응답이 없으면 3초 뒤 다시 확인한다.
    sleep 3
done

echo "${wait_seconds}초 안에 백엔드 기본 기동을 확인하지 못했습니다." >&2
exit 1
