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
# 심박·누적 거리는 아래 시연 실시간 측정값(912) 블록에서만 준다. 두 테이블 모두 V1·V3부터 있으므로 V10을 기다리지 않는다.
result=$(psql_admin <<'SQL'
GRANT SELECT (running_session_id, measured_at, elapsed_duration, speed, cadence)
  ON public.running_metric_samples TO runway_ai;
GRANT SELECT (session_id, action, target_bpm, result, applied_at)
  ON public.session_control_events TO runway_ai;
SELECT has_column_privilege('runway_ai', 'public.running_metric_samples', 'cadence', 'SELECT')
  AND has_column_privilege('runway_ai', 'public.session_control_events', 'applied_at', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'grade', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.running_metric_samples', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('runway_ai', 'public.session_control_events', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo 'BPM 기록 읽기 권한 확인 실패' >&2; exit 1; }
echo 'BPM 기록 읽기 권한 확인 완료'
# 시연 콘솔 지도(S15P31E105-722): 러닝 경로의 세션·시각·위치 세 칸만 준다. 정확도·고도와 쓰기 권한은 없다.
# 대상 회원(demo userAllowlist)의 시연 세션만, 콘솔이 연결돼 있을 때만 읽는다. running_route_points는 V1부터 있다.
result=$(psql_admin <<'SQL'
GRANT SELECT (running_session_id, measured_at, position)
  ON public.running_route_points TO runway_ai;
SELECT has_column_privilege('runway_ai', 'public.running_route_points', 'position', 'SELECT')
  AND has_column_privilege('runway_ai', 'public.running_route_points', 'measured_at', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_route_points', 'accuracy', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_route_points', 'altitude', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.running_route_points', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo '러닝 경로 읽기 권한 확인 실패' >&2; exit 1; }
echo '러닝 경로 읽기 권한 확인 완료'
# 시연 콘솔 실시간 측정값(S15P31E105-912, 2026-11-17 사용자 승인 방식 A): 심박·심박 측정 여부·누적 거리 세 칸을 더 준다.
# 대상 회원(demo userAllowlist)의 시연 세션만, liveMetricsSec가 켜져 있고 콘솔이 연결돼 있을 때만 읽는다.
# 경사·진행 거리·기기·ID 칸과 쓰기 권한은 주지 않는다.
# 주의: 이 스크립트는 master 배포 때 AI CD(Jenkinsfile.ai-cd)가 자동 실행한다. 912가 배포되면 liveMetricsSec가 꺼져 있어도
# 위 열 권한이 부여된다. 912를 되돌릴 때는 이전 커밋 배포 전에 먼저 사람이 아래를 실행한다(옛 스크립트가 heart_rate 미부여를 검사한다).
#   REVOKE SELECT (heart_rate, is_hr_measured, total_distance) ON public.running_metric_samples FROM runway_ai;
result=$(psql_admin <<'SQL'
GRANT SELECT (heart_rate, is_hr_measured, total_distance)
  ON public.running_metric_samples TO runway_ai;
SELECT has_column_privilege('runway_ai', 'public.running_metric_samples', 'heart_rate', 'SELECT')
  AND has_column_privilege('runway_ai', 'public.running_metric_samples', 'is_hr_measured', 'SELECT')
  AND has_column_privilege('runway_ai', 'public.running_metric_samples', 'total_distance', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'grade', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'route_progress', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'device_id', 'SELECT')
  AND NOT has_column_privilege('runway_ai', 'public.running_metric_samples', 'id', 'SELECT')
  AND NOT has_table_privilege('runway_ai', 'public.running_metric_samples', 'INSERT,UPDATE,DELETE,TRUNCATE');
SQL
)
[[ $result == t ]] || { echo '시연 실시간 측정값 읽기 권한 확인 실패' >&2; exit 1; }
echo '시연 실시간 측정값 읽기 권한 확인 완료'
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
