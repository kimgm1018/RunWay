#!/usr/bin/env bash
set -Eeuo pipefail

# 이미지와 모델 설정이 맞고, FastAPI가 모델 로드를 완료했는지 확인한다.
if [[ $# -lt 3 || $# -gt 8 || ! $3 =~ ^[0-9a-f]{64}$ ]]; then
    echo '사용: bash check.sh <컨테이너 ID> <이미지 ID> <모델 SHA256> [대기 초]' >&2
    exit 2
fi
container_id=$1
expected_image=$2
expected_sha=$3
wait_seconds=${4:-120}
require_ode=${5:-false}
[[ $require_ode == true || $require_ode == false ]] || exit 2
if [[ $require_ode == true ]]; then
    for sha in "${6:-}" "${7:-}" "${8:-}"; do [[ $sha =~ ^[0-9a-f]{64}$ ]] || exit 2; done
fi
[[ $wait_seconds =~ ^[1-9][0-9]*$ ]] || exit 2
deadline=$((SECONDS + wait_seconds))
started_at=$(docker inspect --format '{{.State.StartedAt}}' "$container_id") || exit 1

while (( SECONDS < deadline )); do
    actual=$(docker inspect --format '{{.Image}}' "$container_id") || exit 1
    [[ $actual == "$expected_image" ]] || exit 1
    [[ $(docker inspect --format '{{.State.Running}}' "$container_id") == true ]] || exit 1
    [[ $(docker inspect --format '{{.State.Restarting}}' "$container_id") == false ]] || exit 1
    [[ $(docker inspect --format '{{.State.StartedAt}}' "$container_id") == "$started_at" ]] || exit 1
    # Python은 실행 이미지에 있으므로 별도 검사 이미지·공개 포트가 필요 없다.
    if docker exec "$container_id" python -c '
import json, os, sys, urllib.request
try:
    with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=3) as response:
        body = json.load(response)
        ready = response.status == 200 and body.get("status") == "UP" and body.get("modelLoaded") is True
    ready = ready and os.environ.get("HR_MODEL_SHA256") == sys.argv[1]
    if sys.argv[2] == "true":
        ready = ready and all(body.get("models", {}).get(name, {}).get("status") == "UP" for name in ("gru", "ode"))
        for key, expected in zip(("ODEV21_CHECKPOINT_SHA256", "ODEV21_SUMMARY_STATS_SHA256", "ODEV21_POPULATION_BUNDLE_SHA256"), sys.argv[3:]):
            ready = ready and os.environ.get(key) == expected
except Exception:
    ready = False
sys.exit(0 if ready else 1)
' "$expected_sha" "$require_ode" "${6:-}" "${7:-}" "${8:-}"; then
        [[ $(docker inspect --format '{{.State.StartedAt}}' "$container_id") == "$started_at" ]] || exit 1
        [[ $(docker inspect --format '{{.State.Running}}' "$container_id") == true ]] || exit 1
        [[ $(docker inspect --format '{{.State.Restarting}}' "$container_id") == false ]] || exit 1
        echo 'AI 이미지·모델 설정 일치·200/UP 상태 확인 완료.'
        exit 0
    fi
    sleep 2
done
echo "${wait_seconds}초 안에 AI 모델 준비 상태를 확인하지 못했습니다." >&2
exit 1
