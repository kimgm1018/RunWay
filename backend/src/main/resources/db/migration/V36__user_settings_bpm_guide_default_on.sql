-- S15P31E105-706 (V36): 가입 시 BPM 안내 기본값을 켬(true)으로 바꾼 것(SignupRepository)에 맞춰, 설정을 한 번도 바꾸지 않은
-- 기존 사용자도 켠다. user_settings의 모든 UPDATE(설정 PATCH·공개 범위 변경)는 trg_user_settings_updated_at이
-- updated_at을 clock_timestamp()로 바꾸고, 가입 INSERT는 created_at·updated_at이 같은 now()다. 그래서
-- updated_at = created_at인 행만 "손대지 않은 행"으로 본다. 사용자가 일부러 끈 행과 다른 설정만 바꾼 행은 그대로 둔다.
-- updated_at은 직접 쓰지 않는다(DB 트리거가 유일한 작성자, db-schema-convention.md). 구조 변경은 없다.
-- V35(S15P31E105-552 run_derived_private_courses) 다음 번호다.
UPDATE "user_settings"
SET "bpm_guide_enabled" = TRUE
WHERE "bpm_guide_enabled" = FALSE
  AND "updated_at" = "created_at";
