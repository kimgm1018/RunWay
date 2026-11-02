-- S15P31E105-252 W06. Revision of the watch daily HR estimate stored in rhr_bpm.
-- The watch recomputes the same metric_date hourly with an increasing revision; the server keeps the value with
-- the highest revision so that a delayed retry of an older revision cannot overwrite a newer value.
-- NULL means no revisioned value has been stored. Existing rows are kept unchanged.
ALTER TABLE "daily_health_metrics" ADD COLUMN "rhr_revision" INTEGER NULL;

COMMENT ON COLUMN "daily_health_metrics"."rhr_revision" IS 'rhr_bpm 워치 추정값의 revision. 같은 날짜는 더 큰 revision만 rhr_bpm을 갱신. 미저장 시 NULL';

ALTER TABLE "daily_health_metrics" ADD CONSTRAINT "ck_daily_health_metrics_rhr_revision"
    CHECK ("rhr_revision" IS NULL OR "rhr_revision" >= 1);
