#!/usr/bin/env bash
set -Eeuo pipefail

# 사용: bash deploy.sh <새 이미지> <배포 compose.yaml> [배포 기록 폴더]
# 이미지를 만드는 단계는 별도다. 이 스크립트는 기존 배포 교체와 실패 복구를 맡는다.
# 실행 순서: 준비 → 기존 버전 확인 → 이미지 교체 → 새 버전 확인 → 성공 기록 또는 복구.
if [[ $# -lt 2 || $# -gt 3 || ! $1 =~ ^runway-backend:[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]]; then
    echo '사용: bash deploy.sh runway-backend:<버전> /절대/경로/compose.yaml [배포 기록 폴더]' >&2
    exit 2
fi

# 실행할 때 전달받은 이미지 이름과 Compose 경로를 저장한다.
next_image=$1
compose_file=$2
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
probe_image=python:3.12-alpine
deployment_started=false
previous_image_id=
catalog_update_started=false
previous_catalog=

if [[ $compose_file != /* || ! -r $compose_file ]]; then
    echo '읽을 수 있는 배포 Compose 절대 경로가 필요합니다.' >&2
    exit 2
fi

for tool in docker flock grep; do
    command -v "$tool" >/dev/null || { echo "필요한 도구가 없습니다: $tool" >&2; exit 2; }
done

if [[ -n ${BACKEND_LEGACY_HEALTH_IMAGE_ID:-} \
    && ! $BACKEND_LEGACY_HEALTH_IMAGE_ID =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo 'BACKEND_LEGACY_HEALTH_IMAGE_ID는 정확한 sha256 이미지 ID여야 합니다.' >&2
    exit 2
fi

# 같은 에이전트의 다른 작업에서도 동시에 백엔드를 배포하지 못하게 한다.
# 이 경로는 에이전트의 영속 볼륨 안에 있으며 비밀 설정은 저장하지 않는다.
state_dir=${3:-/home/jenkins/agent/deploy-state/backend}
mkdir -p "$state_dir"
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo '이미 백엔드 배포가 진행 중입니다.' >&2; exit 2; }
export BACKEND_API_ROUTES_DEPLOY_LOCK_HELD=true

# CD가 전달한 검증 산출물은 교체 전에 검사하고, 목록도 같은 배포 잠금으로 관리한다.
if [[ -n ${BACKEND_API_ROUTES_FILE:-} ]]; then
    [[ -r $BACKEND_API_ROUTES_FILE ]] || { echo 'API 경로 산출물이 없습니다.' >&2; exit 2; }
    bash "$script_dir/apply-api-routes.sh" validate "$BACKEND_API_ROUTES_FILE"
    previous_catalog=$(bash "$script_dir/apply-api-routes.sh" current)
fi

# 지정한 이미지를 BACKEND_IMAGE에 넣어 같은 Compose 파일로 배포·복구한다.
compose() {
    BACKEND_IMAGE=$1 docker compose -f "$compose_file" "${@:2}"
}

# 검사 프로그램도 배포 전에 준비한다. 다운로드 실패로 기존 서비스를 중단하지 않는다.
docker image inspect "$next_image" >/dev/null
docker image inspect "$probe_image" >/dev/null 2>&1 || docker pull "$probe_image"
compose "$next_image" config --quiet
previous_container=$(compose "$next_image" ps -a -q backend)
if [[ -z $previous_container || $previous_container == *$'\n'* ]]; then
    echo '복구 기준이 될 기존 백엔드 컨테이너 하나가 필요합니다.' >&2
    exit 2
fi
# 태그 이름이 바뀌어도 정확한 이전 이미지로 돌아갈 수 있도록 실제 ID를 기억한다.
previous_image_id=$(docker inspect --format '{{.Image}}' "$previous_container")
docker image inspect "$previous_image_id" >/dev/null
previous_check_mode=readiness
if [[ -n ${BACKEND_LEGACY_HEALTH_IMAGE_ID:-} \
    && $previous_image_id == "$BACKEND_LEGACY_HEALTH_IMAGE_ID" ]]; then
    previous_check_mode=legacy
fi

# 현재 백엔드의 ID를 찾아 check.sh에 상태 검사를 맡긴다.
# 배포 전·배포 후·복구 후에 같은 함수를 사용한다.
check_current() {
    local image=$1 expected_id=$2 mode=${3:-readiness} container_id
    container_id=$(compose "$image" ps -a -q backend)
    [[ -n $container_id ]] || return 1
    bash "$script_dir/check.sh" "$container_id" "$expected_id" "$probe_image" 120 "$mode"
}

# 이전 버전이 정상일 때만 교체한다. 삭제되지 않도록 복구용 태그도 남긴다.
check_current "$next_image" "$previous_image_id" "$previous_check_mode"
docker image tag "$previous_image_id" runway-backend:previous
next_image_id=$(docker image inspect --format '{{.Id}}' "$next_image")

# 이미지 교체 후 오류로 종료될 때 호출한다. 이전 이미지를 실행하고 다시 검사한다.
# 복구에 성공해도 원래 배포는 실패한 것이므로 실패 종료 코드를 유지한다.
rollback() {
    local rc=$?
    trap - EXIT INT TERM
    if [[ $catalog_update_started == true ]]; then
        bash "$script_dir/apply-api-routes.sh" restore "$previous_catalog" \
            || echo 'API 경로 목록 복구 실패: 수동 확인이 필요합니다.' >&2
    fi
    if [[ $deployment_started == true ]]; then
        echo '배포 확인 실패: 이전 이미지로 백엔드를 복구합니다.' >&2
        if compose "$previous_image_id" up -d --no-deps --no-build --pull never backend \
            && check_current "$previous_image_id" "$previous_image_id" "$previous_check_mode"; then
            printf '%s\n' "$previous_image_id" >"$state_dir/current-image"
            echo '이전 이미지 복구 확인 완료. 이번 배포 결과는 실패입니다.' >&2
        else
            echo '이전 이미지 복구 확인도 실패했습니다. 수동 확인이 필요합니다.' >&2
        fi
    fi
    exit "$rc"
}

# 교체 이후 오류·중단이 발생하면 복구를 시도한다. 강제 종료(SIGKILL)는 처리할 수 없다.
# trap은 스크립트 종료·중단 시 아래 복구 처리를 실행하도록 등록하는 설정이다.
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# 여기부터 실제 교체를 시작한다. 기존 이미지와 같으면 재생성 없이 유지될 수 있다.
deployment_started=true
compose "$next_image" up -d --no-deps --no-build --pull never backend
check_current "$next_image" "$next_image_id"

if [[ -n ${BACKEND_API_ROUTES_FILE:-} ]]; then
    catalog_update_started=true
    bash "$script_dir/apply-api-routes.sh" apply "$BACKEND_API_ROUTES_FILE"
fi

# 성공한 이미지 이름은 다음 조회를 위해 영속 볼륨에 남긴다.
# 수동 compose 실행 때도 이 이미지 이름을 BACKEND_IMAGE로 명시해야 한다.
printf '%s\n' "$next_image" >"$state_dir/current-image.tmp"
mv "$state_dir/current-image.tmp" "$state_dir/current-image"
# 모든 검사가 통과했으므로 종료할 때 복구가 실행되지 않도록 해제한다.
deployment_started=false
trap - EXIT INT TERM
echo "백엔드 배포 확인 완료: $next_image"
