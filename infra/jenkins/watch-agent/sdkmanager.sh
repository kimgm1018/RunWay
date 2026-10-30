#!/bin/sh
set -eu

# Android 도구 실행용 Java와 워치 Gradle용 Java를 구분한다.
export JAVA_HOME=/opt/java/openjdk
export PATH="$JAVA_HOME/bin:$PATH"
exec "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" "$@"
