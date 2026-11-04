#!/usr/bin/env bash
set -euo pipefail
directory=/var/lib/runway-monitoring
tmp=$(mktemp "$directory/service-health.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
chmod 0644 "$tmp"

for service in db redis; do
    container="runway-${service}-${service}-1"
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null) || status=unknown
    case "$status" in
        healthy) value=1 ;;
        unhealthy|starting) value=0 ;;
        *) value=-1 ;;
    esac
    printf 'runway_service_healthy{service="%s"} %s\n' "$service" "$value" >> "$tmp"
done
printf 'runway_service_health_collected_timestamp_seconds %s\n' "$(date +%s)" >> "$tmp"
mv -f -- "$tmp" "$directory/service-health.prom"
