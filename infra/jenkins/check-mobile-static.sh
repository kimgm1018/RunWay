#!/bin/sh
set -eu

# MR 검사와 master APK 작업이 같은 모바일 타입 검사·린트 명령을 사용한다. frontend/에서 실행한다.
# 두 검사는 매번 전체 대상을 실행하며, 바뀌지 않은 파일의 결과만 작업 폴더 밖 영속 캐시에서 재사용한다.
# - TypeScript: 증분 정보(.tsbuildinfo)가 파일 내용·의존 관계·컴파일 옵션 변경을 추적한다.
# - ESLint: 내용 기반 캐시. 플러그인·파서 버전 변경은 감지하지 않으므로 의존성·검사 설정 해시별로 캐시를 분리한다.
# 캐시를 지우면 다음 실행은 캐시 없이 전체 검사하며 결과는 같다.
root=${MOBILE_STATIC_CACHE_DIR:-/home/jenkins/agent/.cache/mobile-static}
key=$(cat package.json pnpm-lock.yaml tsconfig.json .eslintrc.js .eslintignore babel.config.js | sha256sum | cut -c1-16)
cache="$root/$key"
mkdir -p "$cache"
touch "$cache"
# 7일 넘게 쓰지 않은 이전 설정의 캐시만 정리한다. executor 1개라 실행 중인 다른 검사와 겹치지 않는다.
find "$root" -mindepth 1 -maxdepth 1 -type d ! -name "$key" -mtime +7 -exec rm -rf {} +

elapsed() { echo $(( $(date +%s) - $1 )); }

started=$(date +%s)
pnpm typecheck --incremental --tsBuildInfoFile "$cache/tsc.tsbuildinfo"
echo "타입 검사 소요 시간: $(elapsed "$started")초 (캐시 $key)"

started=$(date +%s)
pnpm lint --cache --cache-strategy content --cache-location "$cache/eslint-cache"
echo "린트 소요 시간: $(elapsed "$started")초 (캐시 $key)"
