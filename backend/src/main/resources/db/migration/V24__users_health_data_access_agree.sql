-- S15P31E105-314 (V24): users_health_data_access_enum의 동의 값 오타 'AGREEE'를 'AGREE'로 바로잡는다.
-- 이미 적용된 V1은 수정하지 않는다. RENAME VALUE는 enum 라벨만 바꾸므로 기존 동의 회원 행은 그대로 'AGREE'로 읽힌다.
-- 호환 값은 두지 않는다(사용자 확정): 서버 API는 동의 여부를 boolean(granted)으로만 받으므로 'AGREEE' 문자열 입력 경로가 없다.
ALTER TYPE users_health_data_access_enum RENAME VALUE 'AGREEE' TO 'AGREE';
