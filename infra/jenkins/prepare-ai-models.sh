#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# 호스트 Docker가 모델 폴더에 쓴다. 에이전트에는 모델·토큰 파일을 저장하지 않는다.
: "${AI_MODELS_ROOT:?AI_MODELS_ROOT 필요}"
: "${HF_TOKEN:?HF_TOKEN 필요}"
: "${AI_CI_TAG:?AI_CI_TAG 필요}"
[[ $AI_MODELS_ROOT == /* && $AI_MODELS_ROOT != *$'\n'* && $AI_MODELS_ROOT != *$'\r'* && $AI_MODELS_ROOT != *,* ]] || exit 2
[[ $AI_CI_TAG =~ ^[a-z0-9][a-z0-9_.-]{0,95}$ ]] || exit 2
container="runway-ai-models-$AI_CI_TAG"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
mkdir -p artifacts/ai
AI_MODEL_MANIFEST=$(cat infra/ai/models.json)
export AI_MODEL_MANIFEST
# 다운로드 도구는 서비스 실행 이미지와 분리하고 종료 즉시 제거한다.
docker create --name "$container" --user 10001:10001 --read-only \
    --memory 256m --cpus 1 --tmpfs /tmp:rw,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --mount "type=bind,source=$AI_MODELS_ROOT,target=/models" \
    -e HF_TOKEN -e AI_MODEL_MANIFEST -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim-bookworm \
    python -c "$(cat infra/ai/prepare_models.py)" /models \
    --host-root "$AI_MODELS_ROOT" --settings-output /dev/stdout >/dev/null
# 공개 모델 경로·해시만 들어 있다. Jenkins 산출물로 보관하지 않는다.
docker start -a "$container" > artifacts/ai/models.sh
