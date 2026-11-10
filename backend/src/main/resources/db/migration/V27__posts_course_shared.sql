-- S15P31E105-632 (V27): 게시물이 연결 세션의 코스를 함께 공유하는지 여부. CMT01·CMT04 요청 courseShared로 바꾼다.
-- 기존 게시물은 지금까지처럼 코스를 공유하므로 TRUE로 채운다. 세션에 코스가 없으면 서비스가 FALSE로 저장하고 응답에서도 FALSE로 본다.
ALTER TABLE "posts" ADD COLUMN "course_shared" BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN "posts"."course_shared" IS '연결 세션의 코스 공유 여부. FALSE이면 작성자 외 조회자에게 courseId를 숨긴다. 세션에 코스가 없으면 FALSE로 저장한다. 기존 게시물은 TRUE.';
