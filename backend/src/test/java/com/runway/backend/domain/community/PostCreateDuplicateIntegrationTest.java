package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.community.dto.request.CreatePostRequest;
import com.runway.backend.domain.community.service.PostService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S15P31E105-830. 러닝 기록 하나에는 미삭제 커뮤니티 글이 하나만 있다. 같은 기록의 CMT01이 겹쳐도 하나만 성공하고 나머지는 409
 * POST_ALREADY_EXISTS이며, 세션 잠금을 거치지 않는 경로는 부분 UNIQUE 인덱스(uq_posts_session_active)가 막는다.
 */
class PostCreateDuplicateIntegrationTest extends SharedContextIntegrationSupport {
    private static final String DUPLICATE = "POST_ALREADY_EXISTS";

    @Autowired private PostService postService;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private DataSource dataSource;

    private long userId;

    @BeforeEach
    void seed() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('post_dup_user', 'hash', '중복공유', '2000-01-01', 'MALE', '01028302830', 'AGREE')
                        RETURNING id
                        """,
                        Long.class);
    }

    @RepeatedTest(5)
    void 같은기록_동시20회_게시는_하나만_성공한다() throws Exception {
        long sessionId = insertCompletedSession();
        CreatePostRequest request =
                new CreatePostRequest(sessionId, "동시 공유", null, null, null, false);

        List<Callable<Outcome>> tasks = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            tasks.add(() -> Outcome.ok(postService.create(userId, request).id()));
        }
        List<Outcome> results = runTogether(tasks);

        List<Outcome> created = results.stream().filter(Outcome::isOk).toList();
        assertThat(created).hasSize(1);
        assertThat(results).filteredOn(r -> DUPLICATE.equals(r.code())).hasSize(19);
        long postId = created.getFirst().postId();
        assertThat(results)
                .filteredOn(r -> DUPLICATE.equals(r.code()))
                .allSatisfy(r -> assertThat(r.detailPostId()).isEqualTo(postId));
        assertThat(activePosts(sessionId)).isEqualTo(1);
    }

    @RepeatedTest(10)
    void 글삭제와_재공유가_겹쳐도_미삭제글은_하나이하다() throws Exception {
        long sessionId = insertCompletedSession();
        long oldPostId = insertPost(sessionId, false);
        CreatePostRequest request = new CreatePostRequest(sessionId, "재공유", null, null, null, false);

        List<Outcome> results =
                runTogether(
                        List.of(
                                () -> Outcome.ok(postService.create(userId, request).id()),
                                () -> {
                                    postService.delete(userId, oldPostId);
                                    return Outcome.ok(oldPostId);
                                }));

        Outcome create = results.get(0);
        assertThat(results.get(1).isOk()).isTrue();
        assertThat(create.isOk() || DUPLICATE.equals(create.code())).isTrue();
        if (create.isOk()) {
            // CMT05가 먼저 확정됐다: 재공유가 허용되어 새 글 하나만 남는다.
            assertThat(create.postId()).isNotEqualTo(oldPostId);
            assertThat(activePostIds(sessionId)).containsExactly(create.postId());
        } else {
            // CMT01이 먼저 확정됐다: 409(기존 글 ID)이고 그 뒤 CMT05가 기존 글을 지워 미삭제 글이 없다.
            assertThat(create.detailPostId()).isEqualTo(oldPostId);
            assertThat(activePosts(sessionId)).isZero();
        }
    }

    @Test
    void 잠금을_우회한_중복은_DB가_막고_409다() throws Exception {
        long sessionId = insertCompletedSession();
        long deletedPostId = insertPost(sessionId, true);

        // posts INSERT는 FK 검사로 세션 행에 KEY SHARE 잠금을 잡아 CMT01의 세션 FOR UPDATE와 차례가 정해진다. 세션 잠금과 겹치지 않는
        // 경로는 기존 행의 deleted_at을 되돌리는 UPDATE(세션 키 불변)다. 이 미커밋 변경은 CMT01의 재검사에 보이지 않고 인덱스에서만 만난다.
        Outcome outcome = createWhileOtherTransactionRestores(sessionId, deletedPostId, true);

        assertThat(outcome.code()).isEqualTo(DUPLICATE);
        assertThat(outcome.details()).isEmpty();
        assertThat(activePostIds(sessionId)).containsExactly(deletedPostId);
    }

    @Test
    void 잠금을_우회한_변경이_롤백되면_게시는_성공한다() throws Exception {
        long sessionId = insertCompletedSession();
        long deletedPostId = insertPost(sessionId, true);

        Outcome outcome = createWhileOtherTransactionRestores(sessionId, deletedPostId, false);

        assertThat(outcome.isOk()).isTrue();
        assertThat(activePostIds(sessionId)).containsExactly(outcome.postId());
    }

    private Outcome createWhileOtherTransactionRestores(
            long sessionId, long deletedPostId, boolean commit) throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection other = dataSource.getConnection()) {
            other.setAutoCommit(false);
            try (PreparedStatement restore =
                    other.prepareStatement("UPDATE posts SET deleted_at = NULL WHERE id = ?")) {
                restore.setLong(1, deletedPostId);
                assertThat(restore.executeUpdate()).isEqualTo(1);
            }
            Future<Outcome> pending =
                    pool.submit(
                            () ->
                                    capture(
                                            () ->
                                                    Outcome.ok(
                                                            postService
                                                                    .create(
                                                                            userId,
                                                                            new CreatePostRequest(
                                                                                    sessionId,
                                                                                    "우회 경합",
                                                                                    null,
                                                                                    null,
                                                                                    null,
                                                                                    false))
                                                                    .id())));
            awaitInsertBlockedOnLock();
            if (commit) {
                other.commit();
            } else {
                other.rollback();
            }
            return pending.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** CMT01의 INSERT가 다른 트랜잭션의 인덱스 항목을 기다리는 상태(lock_timeout 5초 안)가 될 때까지 기다린다. */
    private void awaitInsertBlockedOnLock() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (System.nanoTime() < deadline) {
            Integer waiting =
                    jdbc.queryForObject(
                            """
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = current_database()
                              AND wait_event_type = 'Lock'
                              AND query ILIKE 'insert into posts%'
                            """,
                            Integer.class);
            if (waiting != null && waiting > 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("CMT01 INSERT가 인덱스 대기 상태가 되지 않았다");
    }

    private List<Outcome> runTogether(List<Callable<Outcome>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Outcome>> futures = new ArrayList<>();
            for (Callable<Outcome> task : tasks) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    return capture(task);
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Outcome> results = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                results.add(future.get(60, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
    }

    private static Outcome capture(Callable<Outcome> task) throws Exception {
        try {
            return task.call();
        } catch (ApiException ex) {
            return new Outcome(ex.code(), null, ex.details());
        }
    }

    private long insertCompletedSession() {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status)
                VALUES (?, 'COMPLETED'::running_sessions_status_enum)
                RETURNING id
                """,
                Long.class,
                userId);
    }

    private long insertPost(long sessionId, boolean deleted) {
        return jdbc.queryForObject(
                """
                INSERT INTO posts(author_id, session_id, body, deleted_at)
                VALUES (?, ?, '기존 글', CASE WHEN ? THEN now() END)
                RETURNING id
                """,
                Long.class,
                userId,
                sessionId,
                deleted);
    }

    private int activePosts(long sessionId) {
        return activePostIds(sessionId).size();
    }

    private List<Long> activePostIds(long sessionId) {
        return jdbc.queryForList(
                "SELECT id FROM posts WHERE session_id = ? AND deleted_at IS NULL ORDER BY id",
                Long.class,
                sessionId);
    }

    private record Outcome(String code, Long postId, Map<String, Object> details) {
        static Outcome ok(long postId) {
            return new Outcome("OK", postId, Map.of());
        }

        boolean isOk() {
            return "OK".equals(code);
        }

        Long detailPostId() {
            Object value = details.get("postId");
            return value == null ? null : ((Number) value).longValue();
        }
    }
}
