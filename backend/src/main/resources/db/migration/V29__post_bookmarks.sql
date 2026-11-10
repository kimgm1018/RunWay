-- S15P31E105-634 (V29): 게시물 스크랩(저장) 관계. CMT16·CMT17로 등록·해제하고 CMT18(내 스크랩 목록)이 저장 시각 최신 순으로 읽는다.
-- post_likes와 같은 구조·제약이다. 게시물은 soft delete이므로 FK 동작도 post_likes와 같게 기본(NO ACTION)으로 둔다.
-- V28은 S15P31E105-633(comment_likes)이 사용한다. Flyway는 버전 공백을 허용하므로 이 파일만으로도 적용된다.
CREATE TABLE "post_bookmarks" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"post_id"	BIGINT		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON TABLE "post_bookmarks" IS '회원의 게시물 스크랩(저장) 관계. 본인만 목록을 본다';

COMMENT ON COLUMN "post_bookmarks"."id" IS '스크랩 ID';

COMMENT ON COLUMN "post_bookmarks"."post_id" IS '게시물 ID';

COMMENT ON COLUMN "post_bookmarks"."user_id" IS '저장한 회원 ID';

COMMENT ON COLUMN "post_bookmarks"."created_at" IS '저장 시각. 내 스크랩 목록 정렬 기준';

ALTER TABLE "post_bookmarks" ADD CONSTRAINT "PK_POST_BOOKMARKS" PRIMARY KEY (
	"id"
);

ALTER TABLE "post_bookmarks" ADD CONSTRAINT "FK_posts_TO_post_bookmarks_1" FOREIGN KEY (
	"post_id"
)
REFERENCES "posts" (
	"id"
);

ALTER TABLE "post_bookmarks" ADD CONSTRAINT "FK_users_TO_post_bookmarks_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "post_bookmarks" ADD CONSTRAINT "uq_post_bookmarks_post_id_user_id" UNIQUE ("post_id", "user_id");

-- 내 스크랩·좋아요 목록(CMT18·CMT19)의 (저장·좋아요 시각, id) 내림차순 커서 조회용.
CREATE INDEX "idx_post_bookmarks_user_id_created_at" ON "post_bookmarks" ("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_post_likes_user_id_created_at" ON "post_likes" ("user_id", "created_at" DESC, "id" DESC);

-- 탈퇴(V17)와 같은 쓰기 차단. post_likes처럼 탈퇴(진행) 회원의 새 스크랩 저장을 거절한다.
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "post_bookmarks"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('user', 'user_id');
