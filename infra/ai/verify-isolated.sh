#!/usr/bin/env bash
set -Eeuo pipefail

# 운영 DB·포트·데이터 볼륨을 사용하지 않는 모델/DB/API 기동 검증이다.
[[ $# == 3 ]] || { echo '사용: verify-isolated.sh <AI 이미지> <공개 모델 설정 파일> <PostGIS 이미지>' >&2; exit 2; }
image=$1
settings=$2
db_image=$3
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$settings"
name="runway-ai-verify-$$"
db="$name-db"
network_created=false
db_created=false
ai_created=false
rollback_project=
temporary=
bad_image=
cleanup() {
    if [[ -n $rollback_project ]]; then
        ids=$(docker ps -aq --filter "label=com.docker.compose.project=$rollback_project" --filter label=com.docker.compose.service=ai)
        [[ -z $ids ]] || docker rm -f $ids >/dev/null 2>&1 || true
        docker network rm "${rollback_project}_default" >/dev/null 2>&1 || true
        docker image rm "runway-ai:previous-$rollback_project" >/dev/null 2>&1 || true
    fi
    [[ $ai_created == false ]] || docker rm -f "$name" >/dev/null 2>&1 || true
    [[ $db_created == false ]] || docker rm -f "$db" >/dev/null 2>&1 || true
    [[ $network_created == false ]] || docker network rm "$name" >/dev/null 2>&1 || true
    [[ -z $bad_image ]] || docker image rm "$bad_image" >/dev/null 2>&1 || true
    if [[ $temporary == /tmp/runway-ai-verify-363.* ]]; then rm -rf -- "$temporary"; fi
}
trap cleanup EXIT

docker network create --internal "$name" >/dev/null
network_created=true
# 이 trust DB에는 합성 코스만 있으며 검증 직후 삭제한다. 운영 DB 설정은 변경하지 않는다.
docker run -d --name "$db" --network "$name" --memory 512m --cpus 1 \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=runway -e POSTGRES_USER=verify_admin \
    "$db_image" >/dev/null
db_created=true
for (( i=0; i<30; i++ )); do
    if docker exec "$db" pg_isready -U verify_admin -d runway >/dev/null 2>&1; then break; fi
    sleep 1
done
docker exec -i "$db" psql -X -q -v ON_ERROR_STOP=1 -U verify_admin -d runway < "$script_dir/tests/smoke-db.sql"

export PERSONAL_PLAN_POPULATION_MODE=median_bundle ODEV21_DEVICE=cpu ODEV21_TORCH_THREADS=1
export GRU_PERSONALIZATION_ENABLED=false ODE_PREVIEW_ENABLED=false DECIDE_FORECAST_ENABLED=false
export PERSONAL_PLAN_EXPERIMENTAL_ENABLED=true
model_env=()
for key in HR_MODEL_SHA256 ODEV21_CHECKPOINT_PATH ODEV21_CHECKPOINT_SHA256 \
    ODEV21_SUMMARY_STATS_PATH ODEV21_SUMMARY_STATS_SHA256 \
    ODEV21_POPULATION_BUNDLE_PATH ODEV21_POPULATION_BUNDLE_SHA256 ODEV21_VARIANT \
    PERSONAL_PLAN_POPULATION_MODE ODEV21_DEVICE ODEV21_TORCH_THREADS \
    GRU_PERSONALIZATION_ENABLED ODE_PREVIEW_ENABLED DECIDE_FORECAST_ENABLED PERSONAL_PLAN_EXPERIMENTAL_ENABLED; do
    model_env+=(-e "$key")
done
mounts=(--mount "type=bind,source=$AI_MODEL_FILE,target=/models/gru_final.pt,readonly"
        --mount "type=bind,source=$AI_MODEL_DIR,target=/models/ode,readonly")
docker run --rm --network none --read-only --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true \
    "${mounts[@]}" "${model_env[@]}" -e HR_MODEL_PATH=/models/gru_final.pt -e AI_DB_URL= \
    "$image" python -c "$(cat "$script_dir/preflight.py")"

docker run -d --name "$name" --network "$name" --init --read-only --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true \
    "${mounts[@]}" "${model_env[@]}" -e HR_MODEL_PATH=/models/gru_final.pt \
    -e "AI_DB_URL=postgresql://runway_ai@$db:5432/runway" "$image" >/dev/null
ai_created=true
image_id=$(docker image inspect --format '{{.Id}}' "$image")
bash "$script_dir/check.sh" "$name" "$image_id" "$HR_MODEL_SHA256" 120 true \
    "$ODEV21_CHECKPOINT_SHA256" "$ODEV21_SUMMARY_STATS_SHA256" "$ODEV21_POPULATION_BUNDLE_SHA256"

# 클라이언트는 별도 컨테이너에서 실행해 AI 메모리 최고치와 섞이지 않게 한다.
docker run --rm --network "container:$name" --read-only --memory 128m --cpus 1 \
    --cap-drop ALL --security-opt no-new-privileges:true python:3.12-slim-bookworm \
    python -c "$(cat "$script_dir/smoke.py")" --course-id 1
docker exec "$name" python -c '
import os, psycopg
with psycopg.connect(os.environ["AI_DB_URL"], autocommit=True) as connection:
    connection.execute("SELECT id FROM courses LIMIT 1").fetchone()
    connection.execute("SET default_transaction_read_only=off")
    try:
        connection.execute("UPDATE courses SET distance=distance WHERE false")
    except psycopg.errors.InsufficientPrivilege:
        print("DB SELECT 성공·UPDATE 권한 거부 확인")
    else:
        raise RuntimeError("읽기 계정에 쓰기 권한 존재")
'
printf 'AI_MEMORY_PEAK_BYTES='
docker exec "$name" cat /sys/fs/cgroup/memory.peak
docker inspect --format 'OOM={{.State.OOMKilled}} RESTARTS={{.RestartCount}}' "$name"

# 시작 직후 실패하는 검증 이미지로 교체해 실제 Compose 롤백을 확인한다.
# marker는 검증용 Compose에서만 확인하므로 모델 사전 검사는 통과하고 기동만 실패한다.
temporary=$(mktemp -d /tmp/runway-ai-verify-363.XXXXXX)
cp -al -- "$AI_MODEL_DIR" "$temporary/previous"
cp -al -- "$AI_MODEL_DIR" "$temporary/next"
printf '%s' "postgresql://runway_ai@$db:5432/runway" > "$temporary/db-url"
chmod 444 "$temporary/db-url"
sed -e "s/name: runway-db_default/name: $name/" \
    -e '/        exec uvicorn/i\        test ! -f /app/ai/service/force-start-fail || exit 1' \
    "$script_dir/compose.yaml" > "$temporary/compose.yaml"
bad_image="runway-ai:verify-rollback-$$"
printf 'FROM %s\nUSER 0:0\nRUN touch /app/ai/service/force-start-fail\nUSER 10001:10001\n' "$image" \
    | docker build --pull=false -t "$bad_image" - >/dev/null
export AI_DB_URL_FILE="$temporary/db-url"
rollback_project="$name-rollback"
export COMPOSE_PROJECT_NAME="$rollback_project"
bash "$script_dir/deploy.sh" "$image" "$temporary/compose.yaml" "$temporary/previous/gru_final.pt" \
    "$HR_MODEL_SHA256" "$temporary/state"
export ODE_PREVIEW_ENABLED=true
if bash "$script_dir/deploy.sh" "$bad_image" "$temporary/compose.yaml" "$temporary/next/gru_final.pt" \
    "$HR_MODEL_SHA256" "$temporary/state"; then
    echo '실패 이미지가 성공 처리됐습니다.' >&2
    exit 1
fi
restored=$(docker ps -q --filter "label=com.docker.compose.project=$rollback_project" --filter label=com.docker.compose.service=ai)
[[ $(docker inspect --format '{{.Image}}' "$restored") == "$image_id" ]]
restored_model=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/models/gru_final.pt"}}{{.Source}}{{end}}{{end}}' "$restored")
[[ $restored_model == "$temporary/previous/gru_final.pt" ]]
[[ $(docker exec "$restored" python -c 'import os; print(os.environ["ODE_PREVIEW_ENABLED"])') == false ]]
echo '실패 배포 거부·이전 이미지/모델 경로/ODE 설정 복구 확인'
echo '격리 모델·DB·API 기동 검증 완료'
