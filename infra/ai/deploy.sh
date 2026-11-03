#!/usr/bin/env bash
set -Eeuo pipefail

# 이미지·모델을 함께 교체한다. 모델 다운로드·파일 덮어쓰기는 하지 않는다.
if [[ $# -lt 4 || $# -gt 5 || ! $1 =~ ^runway-ai:[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ || ! $4 =~ ^[0-9a-f]{64}$ ]]; then
    echo '사용: bash deploy.sh runway-ai:<버전> <Compose 절대 경로> <모델 절대 경로> <SHA256> [기록 폴더]' >&2
    exit 2
fi
next_image=$1
compose_file=$2
next_model=$3
next_sha=$4
project=${COMPOSE_PROJECT_NAME:-runway-ai}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 2
[[ $compose_file == /* && -r $compose_file && $next_model == /* ]] || exit 2
[[ $next_model != *$'\n'* && $next_model != *$'\r'* ]] || exit 2
for tool in docker flock; do command -v "$tool" >/dev/null || exit 2; done

state_dir=${5:-/home/jenkins/agent/deploy-state/ai/$project}
mkdir -p "$state_dir"
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo '같은 AI 프로젝트가 이미 배포 중입니다.' >&2; exit 2; }
compose() {
    local image=$1 model=$2 sha=$3 model_dir
    model_dir=$(dirname -- "$model")
    shift 3
    AI_IMAGE="$image" AI_MODEL_FILE="$model" AI_MODEL_DIR="$model_dir" HR_MODEL_SHA256="$sha" \
        docker compose --env-file /dev/null -p "$project" -f "$compose_file" "$@"
}
check_current() {
    local image=$1 model=$2 sha=$3 expected_id=$4 id
    id=$(compose "$image" "$model" "$sha" ps -a -q ai) || return 1
    [[ -n $id && $id != *$'\n'* ]] || return 1
    bash "$script_dir/check.sh" "$id" "$expected_id" "$sha"
}
record_current() {
    printf '%s\n' "$1" "$2" "$3" >"$state_dir/current-release.tmp"
    mv "$state_dir/current-release.tmp" "$state_dir/current-release"
}

next_id=$(docker image inspect --format '{{.Id}}' "$next_image")
compose "$next_image" "$next_model" "$next_sha" config --quiet
previous_container=$(compose "$next_image" "$next_model" "$next_sha" ps -a -q ai)
[[ $previous_container != *$'\n'* ]] || exit 2
previous_id=
previous_model=
previous_sha=
if [[ -n $previous_container ]]; then
    previous_id=$(docker inspect --format '{{.Image}}' "$previous_container")
    previous_model=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/models/gru_final.pt"}}{{.Source}}{{end}}{{end}}' "$previous_container")
    previous_sha=$(docker exec "$previous_container" python -c 'import os; print(os.environ.get("HR_MODEL_SHA256", ""))')
    [[ $previous_model == /* && $previous_sha =~ ^[0-9a-f]{64}$ ]] || exit 2
    # 새 모델은 새 경로에 둬야 이전 모델 파일로도 복구할 수 있다.
    if [[ $previous_model == "$next_model" && $previous_sha != "$next_sha" ]]; then
        echo '모델 버전 변경 시 기존 파일을 덮어쓰지 말고 새 파일 경로를 사용하세요.' >&2
        exit 2
    fi
    check_current "$previous_id" "$previous_model" "$previous_sha" "$previous_id"
fi

# 교체 전에 새 이미지가 모델을 읽을 수 있는지 독립 컨테이너로 검사한다.
# --mount는 모델 파일이 없으면 실패하며 잘못된 디렉터리를 만들지 않는다.
docker run --rm --pull never --network none --read-only --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true \
    --mount "type=bind,source=$next_model,target=/models/gru_final.pt,readonly" \
    -e HR_MODEL_PATH=/models/gru_final.pt -e HR_MODEL_SHA256="$next_sha" \
    -e HR_DEVICE=cpu -e TORCH_NUM_THREADS=1 "$next_id" \
    python -c 'from app.main import default_loader; model=default_loader(); print("새 AI 이미지·모델 로드 사전 검증 통과")'

if [[ -n $previous_id ]]; then
    docker image tag "$previous_id" "runway-ai:previous-$project"
    printf '%s\n' "$previous_id" "$previous_model" "$previous_sha" >"$state_dir/previous-release.tmp"
    mv "$state_dir/previous-release.tmp" "$state_dir/previous-release"
fi
started=false
rollback() {
    local rc=$?
    trap - EXIT INT TERM
    if [[ $started == true ]]; then
        if [[ -n $previous_id ]]; then
            echo 'AI 배포 확인 실패: 이전 이미지·모델로 복구합니다.' >&2
            if compose "$previous_id" "$previous_model" "$previous_sha" up -d --no-deps --no-build --pull never ai \
                && check_current "$previous_id" "$previous_model" "$previous_sha" "$previous_id"; then
                record_current "$previous_id" "$previous_model" "$previous_sha"
                echo 'AI 이전 버전 복구 완료. 이번 배포 결과는 실패입니다.' >&2
            else
                echo 'AI 복구 확인도 실패했습니다. 수동 확인이 필요합니다.' >&2
            fi
        else
            # 첫 배포에는 이전 버전이 없으므로 이번에 만든 AI 서비스만 제거한다.
            compose "$next_image" "$next_model" "$next_sha" rm -s -f ai || true
            echo '첫 AI 배포 실패: 새 서비스 정리 완료 여부를 확인하세요.' >&2
        fi
    fi
    exit "$rc"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
started=true
compose "$next_image" "$next_model" "$next_sha" up -d --no-deps --no-build --pull never ai
check_current "$next_image" "$next_model" "$next_sha" "$next_id"
record_current "$next_image" "$next_model" "$next_sha"
started=false
trap - EXIT INT TERM
echo "AI 배포 확인 완료: $next_image"
