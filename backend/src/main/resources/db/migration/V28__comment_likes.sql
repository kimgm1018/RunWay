-- S15P31E105-633 (V28): 댓글 좋아요(CMT14·CMT15). post_likes와 같은 구조·제약·삭제 정책을 따른다.
-- 댓글 삭제는 soft delete(comments.deleted_at)라 좋아요 행은 남기고 조회에서 제외한다(post_likes와 같음).
CREATE TABLE "comment_likes" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"comment_id"	BIGINT		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON TABLE "comment_likes" IS '회원과 댓글의 좋아요 관계. 행 존재가 LIKE 반응이다';

COMMENT ON COLUMN "comment_likes"."id" IS '댓글 좋아요 ID';

COMMENT ON COLUMN "comment_likes"."comment_id" IS '댓글 ID';

COMMENT ON COLUMN "comment_likes"."user_id" IS '좋아요한 회원 ID';

COMMENT ON COLUMN "comment_likes"."created_at" IS '생성일시';

ALTER TABLE "comment_likes" ADD CONSTRAINT "PK_COMMENT_LIKES" PRIMARY KEY (
	"id"
);

ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_comments_TO_comment_likes_1" FOREIGN KEY (
	"comment_id"
)
REFERENCES "comments" (
	"id"
);

ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_users_TO_comment_likes_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "comment_likes" ADD CONSTRAINT "uq_comment_likes_comment_id_user_id" UNIQUE ("comment_id", "user_id");

-- 탈퇴 정리(U18)의 회원별 삭제(DELETE ... WHERE user_id=?)가 전체 스캔하지 않도록 user_id 선두 인덱스를 둔다.
CREATE INDEX "idx_comment_likes_user_id" ON "comment_likes" ("user_id");

-- 탈퇴(V17)와 같은 쓰기 차단. post_likes와 같이 탈퇴 회원 행을 새로 넣거나 바꾸지 않는다.
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "comment_likes"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('user', 'user_id');
