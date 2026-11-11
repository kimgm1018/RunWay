#!/bin/sh
set -eu

# MR·master에서 같은 제품 앱 검사와 APK 빌드를 수행한다. 실험용 :demo는 제외한다.
# MR·master에서 --stage로 테스트·Lint·APK 단계를 나눠 호출한다.
# 단계 호출은 한 CI 실행 안에서 같은 Gradle 데몬을 재사용하며, 파이프라인은 성공·실패와 관계없이
# 마지막에 --stage stop으로 데몬을 종료한다.
# 옵션 없이 직접 호출하면 세 작업을 데몬 없이 한 번에 실행한다.
mode=all
if [ "${1:-}" = --stage ]; then
    [ "$#" -ge 2 ] || { echo '단계 이름이 필요합니다.' >&2; exit 2; }
    mode=$2
    shift 2
fi
case "$mode" in
    all) set -- :app:testDebugUnitTest :app:lintDebug :app:assembleDebug "$@" ;;
    test) set -- :app:testDebugUnitTest "$@" ;;
    lint) set -- :app:lintDebug "$@" ;;
    apk) set -- :app:assembleDebug "$@" ;;
    release) set -- :app:assembleRelease "$@" ;;
    stop)
        # 워치 에이전트는 executor 1개라 남아 있는 데몬은 현재 실행이 띄운 것뿐이다.
        # 정리 실패가 원래 검사 결과를 가리지 않도록 경고만 남긴다.
        cd wear
        sh ./gradlew --stop || echo '경고: 워치 Gradle 데몬 종료에 실패했습니다.' >&2
        exit 0 ;;
    *) echo '지원하지 않는 워치 빌드 단계입니다.' >&2; exit 2 ;;
esac
if [ "$mode" = all ]; then
    set -- --no-daemon "$@"
else
    # Jenkins가 sh 단계 종료 때 데몬을 정리하지 않도록 프로세스 쿠키를 바꾼다. 종료는 stop 단계가 맡는다.
    # stop 단계가 실행되지 못해도 10분 동안 쓰이지 않으면 데몬이 스스로 종료한다.
    export JENKINS_NODE_COOKIE=runway-watch-gradle-daemon
    set -- --daemon -Dorg.gradle.daemon.idletimeout=600000 "$@"
fi
cd wear
started=$(date +%s)
# Kotlin 컴파일을 Gradle 데몬 안에서 실행해 별도 Kotlin 데몬이 메모리를 쓰거나 실행 후 남지 않게 한다.
if sh ./gradlew --max-workers=1 --build-cache --profile \
    -Pkotlin.compiler.execution.strategy=in-process "$@"; then
    result=0
else
    result=$?
fi
elapsed=$(( $(date +%s) - started ))
mkdir -p build/reports/profile
report=build/reports/profile/build-time.txt
if [ "$mode" != all ]; then report="build/reports/profile/build-time-$mode.txt"; fi
printf 'duration_seconds=%s\nexit_code=%s\n' "$elapsed" "$result" > "$report"
printf '워치 %s 소요 시간: %s초 (종료 코드: %s)\n' "$mode" "$elapsed" "$result"
if [ "$result" -ne 0 ]; then exit "$result"; fi
if [ "$mode" = all ] || [ "$mode" = apk ]; then
    test -s app/build/outputs/apk/debug/app-debug.apk
elif [ "$mode" = release ]; then
    test -s app/build/outputs/apk/release/app-release.apk
fi
