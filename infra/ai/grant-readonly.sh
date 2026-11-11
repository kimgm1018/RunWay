#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# 개인화 테이블이 없으면 해당 권한만 보류하고 AI 배포는 계속한다.
# 기존 호출의 선택 인자 형식만 유지한다. 테이블 대기는 하지 않는다.
[[ $# -le 1 && ${1:-1} =~ ^[1-9][0-9]*$ ]] || exit 2
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
# 준비도 민감도(S15P31E105-676): 백엔드가 매일 쓰는 daily_readiness(V1부터 있음)의 오늘 점수만 읽는다. 쓰기 권한은 없다.
result=$(psql_admin <<'SQL'
GRANT SELECT ON public.daily_readiness TO runway_ai;
SELECT has_table_privilege('runway_ai', 'public.daily_readiness', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.daily_readiness', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'daily_readiness 읽기 권한 확인 실패' >&2; exit 1; }
echo 'daily_readiness 읽기 권한 확인 완료'
# AI04 목표 BPM 개인 기록(S15P31E105-438): 측정값은 속도·케이던스·시간 칸만, BPM 변경 기록은 BPM·적용 칸만 준다.
# 심박 등 다른 건강 칸은 열지 않는다. 두 테이블 모두 V1·V3부터 있으므로 V10을 기다리지 않는다.
result=$(psql_admin <<'SQL'
GRANT SELECT (running_session_id, measured_at, elapsed_duration, speed, cadence)
  ON public.running_metric_samples TO runway_ai;
GRANT SELECT (session_id, action, target_bpm, result, applied_at)
  ON public.session_control_events TO runway_ai;
SELECT has_column_privilege('runway_ai', 'public.running_metric_samples', 'cadence', 'SELECT')
  AND has_column_privilege('runway_ai', 'public.session_control_events', 'applied_at', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'heart_rate', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.running_metric_samples', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('runway_ai', 'public.session_control_events', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'BPM 기록 읽기 권한 확인 실패' >&2; exit 1; }
echo 'BPM 기록 읽기 권한 확인 완료'
# 개인화 테이블 생성 업무(410)와 AI 배포를 분리한다.
# 테이블이 아직 없어도 기존 테이블의 최소 권한 검증은 생략하지 않는다.
result=$(psql_admin <<'SQL'
SELECT has_database_privilege('runway_ai', 'runway', 'CONNECT')
  AND has_schema_privilege('runway_ai', 'public', 'USAGE')
  AND has_table_privilege('runway_ai', 'public.courses', 'SELECT')
  AND NOT has_schema_privilege('runway_ai', 'public', 'CREATE')
  AND NOT has_table_privilege('runway_ai', 'public.courses', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'AI 기본 읽기 전용 권한 확인 실패' >&2; exit 1; }

ready=$(psql_admin <<'SQL'
SELECT to_regclass('public.user_hr_personalization') IS NOT NULL;
SQL
)
if [[ $ready == f ]]; then
    echo '경고: 개인화 테이블이 아직 없어 해당 SELECT 부여를 건너뜁니다. AI 배포는 계속합니다.' >&2
    echo '테이블 생성 후 AI 배포 또는 이 권한 검사를 다시 실행해야 합니다.' >&2
    exit 0
fi
[[ $ready == t ]] || { echo '개인화 테이블 존재 여부 확인 실패' >&2; exit 1; }

# GRU 개인화와 미래 테이블 전체 권한은 부여하지 않는다.
result=$(psql_admin <<'SQL'
GRANT SELECT ON public.user_hr_personalization TO runway_ai;
SELECT has_table_privilege('runway_ai', 'public.user_hr_personalization', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.user_hr_personalization', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'AI 개인화 읽기 전용 권한 확인 실패' >&2; exit 1; }
echo 'AI 읽기 권한 확인 완료'
