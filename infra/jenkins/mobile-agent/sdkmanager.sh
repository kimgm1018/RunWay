#!/bin/sh
set -eu

# Android 관리 도구는 Java 21로 실행하고 앱 빌드의 Java 17 설정은 유지한다.
export JAVA_HOME=/opt/java/openjdk
export PATH="$JAVA_HOME/bin:$PATH"
exec "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" "$@"
