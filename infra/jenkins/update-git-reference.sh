#!/bin/sh
set -u

# 워치 에이전트 체크아웃이 참조할 bare 저장소에 현재 작업 폴더가 받은 객체를 추가한다.
# 다음 실행은 이 저장소에 없는 새 객체만 GitLab에서 받는다. 네트워크·인증정보는 사용하지 않는다.
# 체크아웃 직후 실행하며, 갱신 실패가 검사 결과를 가리지 않도록 경고만 남긴다.
ref=${1:?'참조 저장소 경로가 필요합니다.'}
src=$(git rev-parse --absolute-git-dir) || exit 0

# 저장소가 아닌 폴더가 남아 있으면, 현재 작업 폴더가 빌려 쓰지 않을 때만 지우고 다시 만든다.
if [ -e "$ref" ] && ! git --git-dir="$ref" rev-parse --is-bare-repository >/dev/null 2>&1; then
    if grep -qsF "$ref" "$src/objects/info/alternates"; then
        echo '경고: 워치 Git 참조 저장소가 손상됐지만 현재 작업 폴더가 사용 중이라 유지합니다.' >&2
        exit 0
    fi
    rm -rf "$ref"
fi
if [ ! -d "$ref" ]; then
    tmp="$ref.tmp"
    rm -rf "$tmp"
    if ! { mkdir -p "$(dirname "$ref")" && git init --bare -q "$tmp" && mv "$tmp" "$ref"; }; then
        echo '경고: 워치 Git 참조 저장소를 만들지 못했습니다.' >&2
        exit 0
    fi
fi
# 작업 폴더가 이 저장소의 객체를 빌려 쓰므로 자동 gc로 객체를 지우지 않는다.
# master 작업은 master만 받으므로 --prune 없이 참조를 추가·갱신만 한다.
if ! { git --git-dir="$ref" config gc.auto 0 &&
    git --git-dir="$ref" fetch -q --no-tags "$src" '+refs/remotes/origin/*:refs/heads/*'; }; then
    echo '경고: 워치 Git 참조 저장소를 갱신하지 못했습니다.' >&2
fi
exit 0
