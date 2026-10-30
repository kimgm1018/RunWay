#!/bin/sh
set -eu
# Secret values are consumed internally; never enable shell tracing or print the ACL file.
if [ -z "${BACKEND_REDIS_USERNAME:-}" ] || [ -z "${BACKEND_REDIS_PASSWORD:-}" ]; then
    echo 'BACKEND_REDIS_USERNAME and BACKEND_REDIS_PASSWORD are required' >&2
    exit 1
fi
case "$BACKEND_REDIS_USERNAME" in
    *[!A-Za-z0-9_-]*|[!A-Za-z]*) echo 'BACKEND_REDIS_USERNAME format error' >&2; exit 1 ;;
esac
if [ "${#BACKEND_REDIS_USERNAME}" -gt 32 ]; then
    echo 'BACKEND_REDIS_USERNAME format error' >&2
    exit 1
fi
if [ "$BACKEND_REDIS_USERNAME" = default ]; then
    echo 'BACKEND_REDIS_USERNAME must use a dedicated app account' >&2
    exit 1
fi
umask 077
acl_file=/tmp/runway-auth.acl
password_digest=$(printf '%s' "$BACKEND_REDIS_PASSWORD" | sha256sum | cut -d ' ' -f 1)
printf 'user default off\nuser %s on #%s ~runway:auth:* -@all +ping +hello +auth +quit +select +client|setname +client|setinfo +type +exists +get +set +del +hget +hmget +hset +pttl +ttl +expireat +zadd +zcard +zrem +zremrangebyscore +zrange +eval +evalsha +time\n' \
    "$BACKEND_REDIS_USERNAME" "$password_digest" > "$acl_file"
unset password_digest
chown redis:redis "$acl_file"
exec /usr/local/bin/docker-entrypoint.sh redis-server /etc/runway/redis.conf --aclfile "$acl_file"
