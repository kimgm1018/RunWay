-- S15P31E105-534 (V20): FK는 인덱스를 자동 생성하지 않는다. 팔로우받는 회원 기준 조회(U26 팔로워 목록,
-- U24 받은 요청 목록, 팔로워 수)가 user_follows 전체를 스캔하지 않도록 승인 여부별 관계 최신순 인덱스를 둔다.
-- is_approved를 키에 두어 승인·대기 중 드문 쪽 목록도 해당 행만 읽는다(승인 UPDATE는 HOT 대상에서 빠진다).
-- 팔로우하는 회원 기준 조회(U27)는 기존 uq_user_follows_follower_id_followee_id로 행을 찾고 정렬은 따로 한다.
CREATE INDEX idx_user_follows_followee_created ON user_follows (followee_id, is_approved, created_at DESC, id DESC);
