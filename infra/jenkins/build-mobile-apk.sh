#!/bin/sh
set -eu

# MR 검증과 master 테스트 배포가 같은 Android 빌드 명령을 사용한다.
# 저장소 루트에서 실행한다. SDK는 Git 밖에서 읽기 전용으로 제공한다.
sdk=/opt/samsung-health/samsung-health-data-api-1.1.0.aar
test -r "$sdk" || { echo '삼성 Health SDK 파일이 필요합니다.' >&2; exit 1; }
cd frontend/android
# 팀 테스트용 ARM64 APK만 빌드한다. Gradle 작업 결과 캐시는 전용 볼륨에 유지한다.
# 앱 APK에 필요한 작업만 실행하고 소요 시간·로컬 성능 보고서를 남긴다.
started=$(date +%s)
if sh ./gradlew --no-daemon --max-workers=2 --build-cache --profile :app:assembleDebug -PreactNativeArchitectures=arm64-v8a "-PsamsungHealthSdk=$sdk" "$@"; then
    result=0
else
    result=$?
fi
elapsed=$(( $(date +%s) - started ))
mkdir -p build/reports/profile
printf 'duration_seconds=%s\nexit_code=%s\n' "$elapsed" "$result" > build/reports/profile/build-time.txt
printf 'APK 빌드 소요 시간: %s초 (종료 코드: %s)\n' "$elapsed" "$result"
if [ "$result" -ne 0 ]; then exit "$result"; fi
test -s app/build/outputs/apk/debug/app-debug.apk
