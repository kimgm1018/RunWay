-- S15P31E105-260: G16 대기방 준비 완료 표시. 기존 참가 행은 false(WAITING).
ALTER TABLE "group_run_participants"
    ADD COLUMN "ready" BOOLEAN DEFAULT false NOT NULL;

COMMENT ON COLUMN "group_run_participants"."ready" IS '대기방 준비 완료 여부. true=READY, false=WAITING. S08 워치 REPORT_PREPARED와 별개.';
