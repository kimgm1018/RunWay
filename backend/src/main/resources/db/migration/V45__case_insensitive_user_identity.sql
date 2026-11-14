-- S15P31E105-831: 닉네임·아이디는 대소문자와 관계없이 하나만 존재한다("Runner"와 "runner"는 같은 값).
-- 아이디는 서버가 소문자로 바꿔 저장·조회하고(CHECK로 보장), 닉네임은 입력 그대로 저장하되 lower() 기준으로 ACTIVE 회원 사이에서 고유하다.
-- 대소문자만 다른 중복이 이미 있으면 자동 이름 변경·삭제 없이 이 마이그레이션 전체가 실패한다(V4와 같은 방식).
-- 같은 트랜잭션에서 옛 UNIQUE를 지우고 새 UNIQUE를 만들므로 고유 제약이 없는 순간은 다른 트랜잭션에 보이지 않는다.
-- 인덱스 이름은 그대로 둔다. 서버는 23505의 제약 이름(uq_users_login_id·uq_users_nickname)으로 409를 고른다.

-- 1. 혹시 남은 대문자 아이디를 소문자로 바꾼다. 로그인 입력도 소문자로 바뀌므로 원래 입력 그대로 계속 로그인된다.
--    탈퇴 해시(SHA-256 소문자 16진)는 이미 소문자라 바뀌지 않는다.
UPDATE users SET login_id = lower(login_id) WHERE login_id <> lower(login_id);

-- 2. 아이디 고유성을 대소문자 무시로 바꾼다. 탈퇴 해시(64자)와 일반 아이디(4~16자)는 길이가 달라 서로 겹치지 않는다.
ALTER TABLE users DROP CONSTRAINT uq_users_login_id;
CREATE UNIQUE INDEX uq_users_login_id ON users (lower(login_id));

-- 3. 앞으로 어떤 경로도 대문자 아이디를 저장하지 못하게 한다.
ALTER TABLE users ADD CONSTRAINT ck_users_login_id_lower CHECK (login_id = lower(login_id));

-- 4. 닉네임 고유성을 ACTIVE 회원 사이의 대소문자 무시로 바꾼다. 저장값은 입력 그대로다.
DROP INDEX uq_users_nickname;
CREATE UNIQUE INDEX uq_users_nickname ON users (lower(nickname)) WHERE account_status = 'ACTIVE';
