#!/bin/sh
set -eu

# MR·master에서 같은 제품 앱 검사와 APK 빌드를 수행한다. 실험용 :demo는 제외한다.
# MR·master에서 --stage로 테스트·Lint·APK 단계를 나눠 호출한다.
# 옵션 없이 직접 호출하면 세 작업을 한 번에 실행한다.
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
    *) echo '지원하지 않는 워치 빌드 단계입니다.' >&2; exit 2 ;;
esac
cd wear
started=$(date +%s)
if sh ./gradlew --no-daemon --max-workers=1 --build-cache --profile \
    "$@"; then
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
fi
