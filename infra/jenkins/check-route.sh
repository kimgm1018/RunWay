#!/bin/sh
set -eu

stage=all
if [ "$#" -gt 0 ]; then
    [ "$#" -eq 2 ] && [ "$1" = --stage ] || { echo '사용법: check-route.sh [--stage test-image|test|clean]' >&2; exit 2; }
    stage=$2
fi
case "$stage" in all|test-image|test|clean) ;; *) echo '잘못된 Route 검사 단계' >&2; exit 2 ;; esac

# 실행별 이름만 사용해 다른 MR·운영 컨테이너와 정리 범위를 구분한다.
tag=${ROUTE_CI_TAG:?ROUTE_CI_TAG is required}
case "$tag" in ''|[!a-z0-9]*|*[!a-z0-9_.-]*) echo 'ROUTE_CI_TAG 형식 오류' >&2; exit 2 ;; esac
[ "${#tag}" -le 96 ] || { echo 'ROUTE_CI_TAG가 너무 깁니다' >&2; exit 2; }
image="runway-route-ci:$tag-test"
container="runway-route-ci-$tag"
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

build_test_image() {
    docker build --target test -t "$image" ai/route_service
}

run_tests() {
    mkdir -p artifacts/route
    # 네트워크·호스트 mount·Secret 없이 실행하고 보고서는 Docker API로 복사한다.
    docker create --name "$container" --network none --memory 1536m --cpus 1 \
        --pids-limit 256 --tmpfs /tmp:rw,nosuid,size=128m \
        --cap-drop ALL --security-opt no-new-privileges:true "$image"
    trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    result=0
    docker start -a "$container" || result=$?
    docker cp "$container:/reports/pytest.xml" artifacts/route/pytest.xml
    # 보고서가 생성돼도 pytest 실패를 성공으로 바꾸지 않는다.
    exit "$result"
}

cleanup() {
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker image rm "$image" >/dev/null 2>&1 || true
}

case "$stage" in
    test-image) build_test_image ;;
    test) run_tests ;;
    clean) cleanup ;;
    all)
        trap cleanup EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        build_test_image
        sh "$0" --stage test
        ;;
esac
