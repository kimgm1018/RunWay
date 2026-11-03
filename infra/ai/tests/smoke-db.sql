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
-- 개인화 테이블이 없을 때 평균 경로로 동작하는지 확인하므로 해당 테이블은 만들지 않는다.
