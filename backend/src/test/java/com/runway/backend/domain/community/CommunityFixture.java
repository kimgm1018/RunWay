package com.runway.backend.domain.community;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** S15P31E105-634 테스트가 함께 쓰는 커뮤니티 합성 데이터. 실제 회원·건강 데이터를 쓰지 않는다. */
final class CommunityFixture {

    private final JdbcTemplate jdbc;
    private int sequence;

    CommunityFixture(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    long user(String loginId, String nickname, String visibility) {
        sequence++;
        long id =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                        RETURNING id
                        """,
                        Long.class,
                        loginId,
                        nickname,
                        "0107634" + String.format("%04d", sequence));
        jdbc.update(
                """
                INSERT INTO user_settings(user_id, voice_coaching_enabled, bpm_guide_enabled,
                  group_notifications_enabled, community_notifications_enabled,
                  location_collection_mode, account_visibility)
                VALUES (?, false, false, false, false, 'OFF', ?::user_settings_account_visibility_enum)
                """,
                id,
                visibility);
        return id;
    }

    void follow(long followerId, long followeeId) {
        jdbc.update(
                "INSERT INTO user_follows(follower_id, followee_id, is_approved) VALUES (?, ?, TRUE)",
                followerId,
                followeeId);
    }

    void unfollow(long followerId, long followeeId) {
        jdbc.update(
                "DELETE FROM user_follows WHERE follower_id=? AND followee_id=?",
                followerId,
                followeeId);
    }

    void makePrivate(long userId) {
        jdbc.update(
                "UPDATE user_settings SET account_visibility='PRIVATE' WHERE user_id=?", userId);
    }

    void withdraw(long userId) {
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                userId);
    }

    long post(long authorId, String body) {
        return insertPost(authorId, body, null, true);
    }

    /** 코스가 있는 세션으로 게시물을 만든다. courseId 조회자 기준 숨김 규칙을 검증할 때 쓴다. */
    long postWithCourse(long authorId, String body, long courseId, boolean courseShared) {
        return insertPost(authorId, body, courseId, courseShared);
    }

    long course() {
        return jdbc.queryForObject(
                """
                INSERT INTO courses(route, start_position, distance)
                VALUES (ST_GeogFromText('LINESTRING(127 37,127.1 37.1)'),
                        ST_GeogFromText('POINT(127 37)'), 5000)
                RETURNING id
                """,
                Long.class);
    }

    private long insertPost(long authorId, String body, Long courseId, boolean courseShared) {
        long sessionId =
                jdbc.queryForObject(
                        """
                        INSERT INTO running_sessions(user_id, status, course_id)
                        VALUES (?, 'COMPLETED'::running_sessions_status_enum, ?)
                        RETURNING id
                        """,
                        Long.class,
                        authorId,
                        courseId);
        return jdbc.queryForObject(
                """
                INSERT INTO posts(author_id, session_id, body, course_shared)
                VALUES (?, ?, ?, ?) RETURNING id
                """,
                Long.class,
                authorId,
                sessionId,
                body,
                courseShared);
    }

    /** S15P31E105-687: 지역 코드가 있는 게시물. regions 시드 코드를 쓴다. */
    long postIn(long authorId, String body, String regionCode) {
        long postId = post(authorId, body);
        jdbc.update("UPDATE posts SET region_code=? WHERE id=?", regionCode, postId);
        return postId;
    }

    void deletePost(long postId) {
        jdbc.update("UPDATE posts SET deleted_at=now() WHERE id=?", postId);
    }

    long bookmark(long userId, long postId, Instant at) {
        return jdbc.queryForObject(
                "INSERT INTO post_bookmarks(post_id, user_id, created_at) VALUES (?, ?, ?) RETURNING id",
                Long.class,
                postId,
                userId,
                Timestamp.from(at));
    }

    long like(long userId, long postId, Instant at) {
        return jdbc.queryForObject(
                "INSERT INTO post_likes(post_id, user_id, created_at) VALUES (?, ?, ?) RETURNING id",
                Long.class,
                postId,
                userId,
                Timestamp.from(at));
    }

    int count(String table, long postId, long userId) {
        Integer count =
                jdbc.queryForObject(
                        "SELECT count(*) FROM " + table + " WHERE post_id=? AND user_id=?",
                        Integer.class,
                        postId,
                        userId);
        return count == null ? 0 : count;
    }

    /** 잠금을 잡은 채 실행할 검증. */
    interface Action {
        void run() throws Exception;
    }

    /**
     * 다른 트랜잭션이 회원 행을 {@code FOR UPDATE}로 잡고 있는 동안 action을 실행한다. 로그인·토큰 갱신·프로필 저장·탈퇴가 같은 회원 행을
     * 잠근 상황을 재현한다. action이 끝나면 잠금 트랜잭션을 끝낸다.
     */
    static void whileUserRowLocked(
            JdbcTemplate jdbc, PlatformTransactionManager transactionManager, long userId, Action action)
            throws Exception {
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<?> holder =
                    pool.submit(
                            () ->
                                    new TransactionTemplate(transactionManager)
                                            .execute(
                                                    status -> {
                                                        jdbc.queryForObject(
                                                                "SELECT id FROM users WHERE id=? FOR UPDATE",
                                                                Long.class,
                                                                userId);
                                                        locked.countDown();
                                                        try {
                                                            release.await(30, TimeUnit.SECONDS);
                                                        } catch (InterruptedException ex) {
                                                            Thread.currentThread().interrupt();
                                                        }
                                                        return null;
                                                    }));
            try {
                if (!locked.await(10, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("회원 행 잠금을 잡지 못했다");
                }
                action.run();
            } finally {
                release.countDown();
                holder.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
