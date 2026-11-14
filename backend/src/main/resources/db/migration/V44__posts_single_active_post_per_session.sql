-- S15P31E105-830 CMT01. 러닝 기록(세션) 하나에는 미삭제 커뮤니티 글 하나만 둔다. 지운 글은 제외하므로 글을 지운 뒤 같은 기록을
-- 다시 공유할 수 있다. CMT01은 세션 행 잠금 아래에서 미삭제 글을 다시 보고 409 POST_ALREADY_EXISTS로 거절하며, 이 인덱스는
-- 잠금을 거치지 않는 경로까지 DB에서 한 번 더 막는다.
-- 같은 기록에 미삭제 글이 이미 2개 이상 있으면 데이터를 바꾸지 않고 실패한다(V5·V8과 같다). 정리는 사람이 결정한다.
CREATE UNIQUE INDEX uq_posts_session_active ON posts(session_id) WHERE deleted_at IS NULL;
