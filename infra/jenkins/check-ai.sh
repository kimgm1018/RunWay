#!/bin/sh
set -eu

# Jenkins 단계별 호출 또는 로컬 전체 검사에 같은 명령을 사용한다.
stage=all
if [ "$#" -gt 0 ]; then
    [ "$#" -eq 2 ] && [ "$1" = --stage ] || { echo '사용법: check-ai.sh [--stage test-image|test|image|clean]' >&2; exit 2; }
    stage=$2
fi
case "$stage" in all|test-image|test|image|clean) ;; *) echo '잘못된 AI 검사 단계' >&2; exit 2 ;; esac

# 작업별 태그를 지정해 다른 CI의 이미지·컨테이너와 섞이지 않게 한다.
tag=${AI_CI_TAG:?AI_CI_TAG is required}
case "$tag" in ''|[!a-z0-9]*|*[!a-z0-9_.-]*) echo 'AI_CI_TAG 형식 오류' >&2; exit 2 ;; esac
[ "${#tag}" -le 96 ] || { echo 'AI_CI_TAG가 너무 깁니다' >&2; exit 2; }
test_image="runway-ai-ci:$tag-test"
runtime_image="runway-ai-ci:$tag-runtime"
container="runway-ai-ci-$tag"
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

test_image_build() {
    docker build --target test -f infra/ai/Dockerfile -t "$test_image" .
}

run_tests() {
    mkdir -p artifacts/ai
    # Docker가 호스트에서 실행되므로 workspace bind 대신 API로 보고서를 복사한다.
    docker create --name "$container" --network none --memory 1g --cpus 1 \
        --tmpfs /tmp:rw,nosuid,size=64m \
        --cap-drop ALL --security-opt no-new-privileges:true "$test_image"
    trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
    result=0
    docker start -a "$container" || result=$?
    # /reports는 컨테이너 쓰기 계층에 보관해 종료 후에도 복사할 수 있게 한다.
    # pytest 종료 코드와 보고서를 둘 다 확인해 테스트 실패를 성공으로 바꾸지 않는다.
    docker cp "$container:/reports/pytest.xml" artifacts/ai/pytest.xml
    exit "$result"
}

image_build() {
    docker build --target runtime -f infra/ai/Dockerfile -t "$runtime_image" .
}

cleanup() {
    # 이번 실행에 지정한 태그만 정리한다. 모델·운영 이미지는 건드리지 않는다.
    docker image rm "$test_image" "$runtime_image" >/dev/null 2>&1 || true
}

case "$stage" in
    test-image) test_image_build ;;
    test) run_tests ;;
    image) image_build ;;
    clean) cleanup ;;
    all)
        # test는 보고서 복사 후 종료하므로 별도 셸로 호출한다.
        trap cleanup EXIT
        test_image_build
        sh "$0" --stage test
        image_build
        ;;
esac
