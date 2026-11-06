-- S15P31E105-458: in-app inbox logical-event dedupe.
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" VARCHAR(200);
UPDATE "notifications" SET "dedupe_key" = 'LEGACY:' || "id"::text WHERE "dedupe_key" IS NULL;
ALTER TABLE "notifications" ALTER COLUMN "dedupe_key" SET NOT NULL;
ALTER TABLE "notifications" ADD CONSTRAINT "UK_NOTIFICATIONS_DEDUPE_KEY" UNIQUE ("dedupe_key");

COMMENT ON COLUMN "notifications"."dedupe_key" IS '논리 사건 중복 방지 키(S15P31E105-458). 동일 키 재삽입을 허용하지 않는다. 형식은 종류별 서비스 규칙(예: FOLLOW_REQUEST:{requestId}).';
COMMENT ON COLUMN "notifications"."notification_type" IS '알림 종류 코드. GROUP_RUN_PARTICIPATION_CANCELLED: G13 그룹런 취소(코드명 유지, 참가 취소 알림 아님), CREW_JOIN_APPROVED: 크루 가입 승인, CREW_JOIN_REJECTED: 크루 가입 거절, POST_COMMENT: 게시물 댓글, GROUP_RUN_START_REMINDER: 그룹런 시작 임박, NEW_FOLLOWER: 공개 계정 새 팔로워, FOLLOW_REQUEST: 비공개 팔로우 요청, FOLLOW_APPROVED: 수동 팔로우 승인. 알림 종류로 target_id의 대상과 이동 화면을 결정하며 별도 target_type은 두지 않는다.';
COMMENT ON COLUMN "notifications"."target_id" IS '알림 클릭 시 이동 대상 ID. GROUP_RUN_PARTICIPATION_CANCELLED/GROUP_RUN_START_REMINDER는 group_runs.id(그룹런 상세), CREW_JOIN_APPROVED/CREW_JOIN_REJECTED는 crews.id(크루 상세), POST_COMMENT는 posts.id(게시글 상세), NEW_FOLLOWER/FOLLOW_REQUEST는 행위자 users.id, FOLLOW_APPROVED는 승인자 users.id. 여러 테이블을 가리키므로 단일 FK는 두지 않고 서비스에서 종류별 대상 존재와 현재 열람 권한을 검증한다. 삭제된 대상은 이동 불가로 안내한다.';
