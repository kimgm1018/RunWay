#!/usr/bin/env bash
set -Eeuo pipefail
set +x

: "${HF_TOKEN:?HF_TOKEN 필요}"
: "${ROUTE_DATA_ROOT:?ROUTE_DATA_ROOT 필요}"
: "${ROUTE_BUILD_TAG:?ROUTE_BUILD_TAG 필요}"
[[ $ROUTE_DATA_ROOT == /home/ubuntu/runway/data/route-bundles ]] || exit 2
[[ $ROUTE_BUILD_TAG =~ ^[a-z0-9][a-z0-9_.-]{0,95}$ ]] || exit 2
container="runway-route-data-$ROUTE_BUILD_TAG"
tool_image="runway-route-data-tool:$ROUTE_BUILD_TAG"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; docker image rm "$tool_image" >/dev/null 2>&1 || true' EXIT
mkdir -p artifacts/route/downloader
cp infra/ai/prepare_models.py artifacts/route/downloader/prepare_models.py
cp infra/route/prepare_data.py artifacts/route/downloader/prepare_data.py
docker build -f infra/route/Dockerfile.download -t "$tool_image" artifacts/route/downloader
docker create --name "$container" --user 10001:10001 --read-only \
    --memory 256m --cpus 1 --tmpfs /tmp:rw,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --mount "type=bind,source=$ROUTE_DATA_ROOT,target=/data" \
    -e HF_TOKEN "$tool_image" >/dev/null
docker start -a "$container" > artifacts/route/data-settings.txt
revision=$(sed -n 's/^ROUTE_DATA_REVISION=\([0-9a-f]\{40\}\)$/\1/p' artifacts/route/data-settings.txt)
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 2
echo "Route 데이터 revision: $revision"
# 빌드 context는 Docker CLI가 읽으므로 데이터만 작업 폴더로 복사한다.
# 토큰은 복사·보관하지 않는다. 데이터는 Jenkins 산출물로 보관하지 않는다.
test ! -e artifacts/route/data
docker cp "$container:/data/$revision" artifacts/route/data
