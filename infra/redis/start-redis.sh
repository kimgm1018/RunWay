#!/bin/sh
set -eu

# 비밀번호 값은 Compose나 이미지에 넣지 않고 시작할 때 파일에서 읽는다.
test -s /run/secrets/redis_app_password
export BACKEND_REDIS_PASSWORD="$(cat /run/secrets/redis_app_password)"
exec /bin/sh /etc/runway/entrypoint.sh
