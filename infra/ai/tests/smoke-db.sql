-- 운영 DB용 migration이 아니다. 외부 포트 없는 격리 DB의 합성 기동 검증 전용이다.
CREATE ROLE runway_ai LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE runway_ai SET default_transaction_read_only = on;
CREATE TABLE courses (
    id bigint PRIMARY KEY,
    distance numeric NOT NULL,
    elevation_profile jsonb,
    status text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO courses (id, distance, status) VALUES (1, 1000, 'ACTIVE');
GRANT CONNECT ON DATABASE runway TO runway_ai;
GRANT USAGE ON SCHEMA public TO runway_ai;
GRANT SELECT ON courses TO runway_ai;
-- AI09 속도 보정 v_ref(SPEED_REF_SQL)·목표 심박 이력(TARGET_HR_HISTORY_SQL) 조회에 쓰는 컬럼만 둔다. 운영은 grant-readonly.sh가 같은 권한을 준다.
CREATE TABLE running_sessions (
    id bigint PRIMARY KEY,
    user_id bigint NOT NULL,
    status text NOT NULL,
    ended_at timestamptz,
    total_distance numeric,
    moving_duration integer,
    elapsed_duration integer,
    average_heart_rate numeric(7, 2),
    deleted_at timestamptz
);
GRANT SELECT ON running_sessions TO runway_ai;
-- 개인화 테이블이 없을 때 평균 경로로 동작하는지 확인하므로 해당 테이블은 만들지 않는다.
