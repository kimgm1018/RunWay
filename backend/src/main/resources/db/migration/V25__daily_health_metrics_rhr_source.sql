-- S15P31E105-600 (V25): rhr_bpm의 출처. W06이 RunWay 워치 추정값과 삼성 헬스 심박으로 폰이 계산한 값을 함께 받으므로
-- 같은 날짜의 우선순위(워치 우선)와 R01 출처 표시에 쓴다. V25 이전 rhr_bpm은 W06 RUNWAY_WATCH만 저장했으므로 그 값으로 채운다.
ALTER TABLE "daily_health_metrics" ADD COLUMN "rhr_source" VARCHAR(20) NULL;

UPDATE "daily_health_metrics" SET "rhr_source" = 'RUNWAY_WATCH' WHERE "rhr_bpm" IS NOT NULL;

COMMENT ON COLUMN "daily_health_metrics"."rhr_source" IS 'rhr_bpm 출처. RUNWAY_WATCH(워치 추정) 또는 SAMSUNG_HEALTH(삼성 헬스 심박으로 폰 계산). 미저장·출처 미상이면 NULL';

ALTER TABLE "daily_health_metrics" ADD CONSTRAINT "ck_daily_health_metrics_rhr_source"
    CHECK ("rhr_source" IS NULL OR "rhr_source" IN ('RUNWAY_WATCH', 'SAMSUNG_HEALTH'));
-- rhr_bpm과 rhr_source의 짝 CHECK는 두지 않는다. W06 밖에서 rhr_bpm만 넣는 경로(운영 수동 보정·테스트 데이터)를 막지 않기 위해서다.
-- 출처가 NULL인 값은 V25 이전 값과 같게 취급한다(W06 워치 우선 규칙에서 삼성 헬스 값이 덮어쓰지 않음).
