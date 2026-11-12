-- S15P31E105-704 (V37): 러닝 기록 공유 링크. H08(running-records.md)로 본인 기록에 발급하고, H09로 로그인 없이 조회한다.
-- 기록 하나에 링크 하나(session_id UNIQUE)이며 같은 기록을 다시 공유하면 같은 token을 돌려준다. 그래서 token은 평문으로 저장한다.
-- 동시에 처음 발급하면 session_id UNIQUE 충돌을 INSERT ... ON CONFLICT로 받아 이미 저장된 행을 돌려준다.
-- 기록 삭제(running_sessions.deleted_at) 뒤에는 H09가 404이며 행은 남긴다. 회원 탈퇴(U18, WithdrawalRepository.scrub)는 그 회원의 링크 행을 삭제한다(링크 취소는 후속 업무).
-- V36(S15P31E105-706) 다음 번호다.
CREATE TABLE "run_share_links" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"session_id"	BIGINT		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"token"	VARCHAR(64)		NOT NULL,
	"title"	VARCHAR(40)		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON TABLE "run_share_links" IS '러닝 기록 공유 링크. 기록(세션) 하나에 링크 하나. 링크를 아는 사람은 로그인 없이 H09로 표시용 요약·경로를 본다';

COMMENT ON COLUMN "run_share_links"."id" IS '공유 링크 ID';

COMMENT ON COLUMN "run_share_links"."session_id" IS '공유한 러닝 세션 ID. UNIQUE';

COMMENT ON COLUMN "run_share_links"."user_id" IS '발급한 회원 ID. 세션 소유자와 같다';

COMMENT ON COLUMN "run_share_links"."token" IS '공유 토큰. 32바이트 난수의 base64url(패딩 없음, 43자). 같은 기록의 재공유에 같은 값을 돌려주므로 평문 저장';

COMMENT ON COLUMN "run_share_links"."title" IS '앱이 보낸 기록 제목(앞뒤 공백 제거 후 1~40자). 재공유 때 바뀌면 갱신';

COMMENT ON COLUMN "run_share_links"."created_at" IS '발급 시각';

COMMENT ON COLUMN "run_share_links"."updated_at" IS '수정일시';

ALTER TABLE "run_share_links" ADD CONSTRAINT "PK_RUN_SHARE_LINKS" PRIMARY KEY (
	"id"
);

ALTER TABLE "run_share_links" ADD CONSTRAINT "FK_running_sessions_TO_run_share_links_1" FOREIGN KEY (
	"session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "run_share_links" ADD CONSTRAINT "FK_users_TO_run_share_links_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "run_share_links" ADD CONSTRAINT "uq_run_share_links_session_id" UNIQUE ("session_id");

ALTER TABLE "run_share_links" ADD CONSTRAINT "uq_run_share_links_token" UNIQUE ("token");

CREATE TRIGGER "trg_run_share_links_updated_at"
    BEFORE UPDATE ON "run_share_links"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 탈퇴(V17)와 같은 쓰기 차단. 탈퇴(진행) 회원의 새 링크 발급·제목 변경을 거절한다.
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "run_share_links"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('user', 'user_id');
