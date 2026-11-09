-- S15P31E105-570 (V21): 크루 가입 방식을 서버에 저장한다. APPROVAL=크루장 승인(M06), INSTANT=바로 가입(M04에서 정원 안이면 즉시 APPROVED).
-- 기존 크루는 지금까지의 확정 동작(크루장 승인)을 유지하도록 APPROVAL로 채운다.
CREATE TYPE "crews_join_policy_enum" AS ENUM ('APPROVAL', 'INSTANT');

ALTER TABLE "crews"
    ADD COLUMN "join_policy" "crews_join_policy_enum" DEFAULT 'APPROVAL' NOT NULL;

COMMENT ON COLUMN "crews"."join_policy" IS '가입 방식. APPROVAL=크루장 승인 후 멤버, INSTANT=신청 즉시 멤버(정원 안). 크루장이 M12로 변경한다.';
