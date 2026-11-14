-- S15P31E105-829: 활동 중인 크루끼리 이름(대소문자·앞뒤 공백 무시) 중복 금지. 해산(INACTIVE) 크루 이름은 재사용할 수 있다.
-- 기존 중복이 있으면 데이터를 바꾸지 않고 실패한다(V4 방식). 운영 DB 기존 중복 0건 확인(2026-11-14, 읽기 전용).
-- 사전 조회(CrewRepository.existsActiveByNormalizedName)와 같은 식을 쓴다.
CREATE UNIQUE INDEX uq_crews_active_name ON crews (lower(btrim(name))) WHERE status = 'ACTIVE';
