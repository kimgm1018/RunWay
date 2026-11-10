package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.community.dto.request.CreatePostRequest;
import com.runway.backend.domain.community.service.PostService;
import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S15P31E105-280. CMT01 게시물 생성과 S09 세션 삭제가 겹쳐도 삭제된 세션을 가리키는 미삭제 게시물이 남지 않는지 확인한다.
 */
class PostCreateSessionDeleteConcurrencyIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private PostService postService;
    @Autowired private RunningSessionService runningSessionService;
    @Autowired private JdbcTemplate jdbc;

    private long userId;
    private long watchId;
    private long phoneId;

    @BeforeEach
    void seed() {
        userId = insertUser("post_race_user", "경합유저", "01028002800");
        watchId = insertDevice(userId, "WATCH");
        phoneId = insertDevice(userId, "PHONE");
    }

    @RepeatedTest(10)
    void CMT01과_S09가_겹쳐도_삭제된_세션에_미삭제_게시물이_남지_않는다() throws Exception {
        long sessionId =
                insertCompletedSession(userId, watchId, phoneId, "READY");
        CreatePostRequest request = new CreatePostRequest(sessionId, "경합 게시물", null, null, null, null);

        List<String> results =
                runTogether(
                        List.of(
                                () -> {
                                    postService.create(userId, request);
                                    return "OK";
                                },
                                () -> {
                                    runningSessionService.delete(userId, sessionId);
                                    return "OK";
                                }));

        assertThat(results).hasSize(2);
        assertThat(results).contains("OK");
        // 한쪽만 실패할 수 있다: 생성이 늦으면 INVALID_POST, 삭제가 늦으면 게시물 soft-delete 후 둘 다 OK.
        assertThat(results)
                .allMatch(code -> "OK".equals(code) || "INVALID_POST".equals(code));

        Integer undeletedOnDeletedSession =
                jdbc.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM posts p
                        INNER JOIN running_sessions s ON s.id = p.session_id
                        WHERE p.session_id = ?
                          AND p.deleted_at IS NULL
                          AND s.deleted_at IS NOT NULL
                        """,
                        Integer.class,
                        sessionId);
        assertThat(undeletedOnDeletedSession).isZero();

        Boolean sessionDeleted =
                jdbc.queryForObject(
                        "SELECT deleted_at IS NOT NULL FROM running_sessions WHERE id=?",
                        Boolean.class,
                        sessionId);
        // 삭제가 성공했거나, 생성이 먼저여도 삭제가 OK면 세션은 삭제된다. 생성이 성공하고 삭제가 실패하는 경우는
        // 이 시나리오(삭제 가능 COMPLETED)에서 나오면 안 된다.
        if (results.stream().filter("OK"::equals).count() == 2) {
            assertThat(sessionDeleted).isTrue();
            Integer activePosts =
                    jdbc.queryForObject(
                            """
                            SELECT COUNT(*) FROM posts
                            WHERE session_id = ? AND deleted_at IS NULL
                            """,
                            Integer.class,
                            sessionId);
            assertThat(activePosts).isZero();
        } else if (results.contains("INVALID_POST")) {
            assertThat(sessionDeleted).isTrue();
            Integer posts =
                    jdbc.queryForObject(
                            "SELECT COUNT(*) FROM posts WHERE session_id = ?",
                            Integer.class,
                            sessionId);
            assertThat(posts).isZero();
        }
    }

    private List<String> runTogether(List<Callable<String>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<String>> futures = new ArrayList<>();
            for (Callable<String> task : tasks) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    try {
                                        return task.call();
                                    } catch (ApiException ex) {
                                        return ex.code();
                                    }
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<String> results = new ArrayList<>();
            for (Future<String> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    private long insertDevice(long ownerId, String type) {
        return jdbc.queryForObject(
                """
                INSERT INTO user_devices(user_id, device_type, linked_at)
                VALUES (?, ?::user_devices_device_type_enum, now())
                RETURNING id
                """,
                Long.class,
                ownerId,
                type);
    }

    private long insertCompletedSession(
            long ownerId, long controlId, long relayId, String analysisStatus) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(
                  user_id, status, state_version, control_device_id, relay_device_id,
                  analysis_status, started_at)
                VALUES (
                  ?, 'COMPLETED'::running_sessions_status_enum, 5, ?, ?,
                  ?::running_sessions_analysis_status_enum, now())
                RETURNING id
                """,
                Long.class,
                ownerId,
                controlId,
                relayId,
                analysisStatus);
    }
}
