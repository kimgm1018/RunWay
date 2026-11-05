#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# 백엔드 CD와 동시에 시작해도 V10이 완료되기 전에는 없는 테이블에 GRANT하지 않는다.
wait_seconds=${1:-900}
[[ $wait_seconds =~ ^[1-9][0-9]*$ ]] || exit 2
container=$(docker ps --filter label=com.docker.compose.project=runway-db \
    --filter label=com.docker.compose.service=db --format '{{.ID}}')
[[ -n $container && $container != *$'\n'* ]] || { echo '실행 중인 DB 하나가 필요합니다.' >&2; exit 2; }
psql_admin() {
    docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U runway_admin -d runway
}
# AI09 속도 보정 v_ref(S15P31E105-402): running_sessions는 V1부터 있으므로 V10을 기다리지 않고 먼저 준다.
result=$(psql_admin <<'SQL'
GRANT SELECT ON public.running_sessions TO runway_ai;
SELECT has_table_privilege('runway_ai', 'public.running_sessions', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.running_sessions', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'running_sessions 읽기 권한 확인 실패' >&2; exit 1; }
echo 'running_sessions 읽기 권한 확인 완료'
# AI09 신규 사용자 가입 기준(S15P31E105-403): user_profiles도 V1부터 있으므로 먼저 준다.
# 지난 러닝 수(n)는 위 running_sessions 권한을 같이 쓴다.
result=$(psql_admin <<'SQL'
GRANT SELECT ON public.user_profiles TO runway_ai;
SELECT has_table_privilege('runway_ai', 'public.user_profiles', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.user_profiles', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'user_profiles 읽기 권한 확인 실패' >&2; exit 1; }
echo 'user_profiles 읽기 권한 확인 완료'
# 대기 한도는 V10 대기에만 쓴다(앞의 선부여 시간은 포함하지 않는다).
deadline=$((SECONDS + wait_seconds))
echo 'V10 적용·AI 개인화 테이블 준비를 확인합니다.'
while (( SECONDS < deadline )); do
    ready=$(psql_admin <<'SQL'
SELECT to_regclass('public.user_hr_personalization') IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version = '10' AND success);
SQL
    )
    if [[ $ready == t ]]; then
        # GRU 개인화 테이블은 현재 범위가 아니다. 미래 테이블 전체 권한도 부여하지 않는다.
        result=$(psql_admin <<'SQL'
GRANT SELECT ON public.user_hr_personalization TO runway_ai;
SELECT has_database_privilege('runway_ai', 'runway', 'CONNECT')
  AND has_schema_privilege('runway_ai', 'public', 'USAGE')
  AND has_table_privilege('runway_ai', 'public.courses', 'SELECT')
  AND has_table_privilege('runway_ai', 'public.user_hr_personalization', 'SELECT')
  AND NOT has_schema_privilege('runway_ai', 'public', 'CREATE')
  AND NOT has_table_privilege('runway_ai', 'public.courses', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('runway_ai', 'public.user_hr_personalization', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
        )
        [[ $result == t ]] || { echo 'AI 읽기 전용 권한 확인 실패' >&2; exit 1; }
        echo 'V10·AI 읽기 권한 확인 완료'
        exit 0
    fi
    sleep 5
done
echo 'V10 미적용 또는 개인화 테이블 미준비로 AI 배포를 중단합니다.' >&2
exit 1
