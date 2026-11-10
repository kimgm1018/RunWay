-- S15P31E105-639 (V30): 준비도 계산에 쓴 수면(S)·회복(R)·부하(L) 항목 점수와 R에 쓴 안정 심박 변화율.
-- 자동 평가가 readiness_score와 같은 upsert로 함께 저장하므로 항상 같은 입력으로 계산한 값이다. 계산에서 제외된 항목은 NULL이다.
-- V30 이전 결과는 소급 계산하지 않고 NULL로 두며, 그 날짜가 다시 평가되면 채워진다.
ALTER TABLE "daily_readiness" ADD COLUMN "sleep_score" NUMERIC(7,2) NULL;
ALTER TABLE "daily_readiness" ADD COLUMN "recovery_score" NUMERIC(7,2) NULL;
ALTER TABLE "daily_readiness" ADD COLUMN "load_score" NUMERIC(7,2) NULL;
ALTER TABLE "daily_readiness" ADD COLUMN "rhr_change_pct" NUMERIC(7,1) NULL;

COMMENT ON COLUMN "daily_readiness"."sleep_score" IS '수면 항목 점수 S(0~100). 계산에서 제외되면 NULL';

COMMENT ON COLUMN "daily_readiness"."recovery_score" IS '회복 항목 점수 R(0~100). 계산에서 제외되면 NULL';

COMMENT ON COLUMN "daily_readiness"."load_score" IS '훈련 부하 항목 점수 L(0~100). 계산에서 제외되면 NULL';

COMMENT ON COLUMN "daily_readiness"."rhr_change_pct" IS 'R 계산에 쓴 평소(D-7~D-1 평균) 대비 기준일 안정시 심박 변화율(%). R이 제외되면 NULL';
