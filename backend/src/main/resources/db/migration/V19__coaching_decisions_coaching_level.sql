-- S15P31E105-503: AI04 coachingLevel 저장(OK/CAUTION/DANGER, null 허용).
ALTER TABLE "coaching_decisions" ADD COLUMN "coaching_level" VARCHAR(16) NULL;

ALTER TABLE "coaching_decisions" ADD CONSTRAINT "ck_coaching_decisions_coaching_level"
    CHECK ("coaching_level" IS NULL OR "coaching_level" IN ('OK', 'CAUTION', 'DANGER'));

COMMENT ON COLUMN "coaching_decisions"."coaching_level" IS 'AI04 코칭 단계 OK/CAUTION/DANGER(S15P31E105-503). AI가 단계를 주지 않았거나 이전 행이면 null.';
