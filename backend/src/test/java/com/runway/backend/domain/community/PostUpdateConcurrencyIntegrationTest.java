package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.community.dto.request.UpdatePostRequest;
import com.runway.backend.domain.community.service.PostService;
import com.runway.backend.domain.readiness.service.ReadinessEvaluationDispatcher;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadDispatcher;
import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S15P31E105-632 리뷰 A-1/B-1. CMT04 수정이 다른 CMT04·S09 세션 삭제·CMT05 삭제와 겹쳐도 먼저 커밋된
 * course_shared·deleted_at을 낡은 값으로 덮지 않는지 확인한다.
 */
class PostUpdateConcurrencyIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private PostService postService;
    @Autowired private RunningSessionService runningSessionService;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private TrainingLoadDispatcher trainingLoadDispatcher;
    @Autowired private ReadinessEvaluationDispatcher readinessDispatcher;

    private long userId;
    private long watchId;
    private long phoneId;
    private long courseId;

    @BeforeEach
    void seed() {
        userId = insertUser("post_update_race", "수정경합", "01063206320");
        watchId = insertDevice(userId, "WATCH");
        phoneId = insertDevice(userId, "PHONE");
        courseId =
                jdbc.queryForObject(
                        """
                        INSERT INTO courses(route, start_position, distance)
                        VALUES (ST_GeogFromText('LINESTRING(127 37,127.1 37.1)'),
                                ST_GeogFromText('POINT(127 37)'), 5000)
                        RETURNING id
                        """,
                        Long.class);
    }

    /**
     * S09는 커밋 뒤 러닝 부하 재계산(TrainingLoadDispatcher)을 별도 스레드에 넘기고, 그 결과가 준비도 재평가(ReadinessEvaluationDispatcher)로
     * 이어질 수 있다. 이 작업이 남은 채 다음 반복의 공용 TRUNCATE가 시작되면 잠금 순서가 엇갈려 deadlock이 날 수 있으므로, 테스트마다 두
     * 실행기가 모두 비워질 때까지 기다린다. 부하 작업이 준비도 작업을 만들 수 있어 부하 실행기를 먼저 기다린다.
     */
    @AfterEach
    void awaitAsyncSideWork() throws InterruptedException {
        assertThat(trainingLoadDispatcher.awaitIdle(Duration.ofSeconds(30))).isTrue();
        assertThat(readinessDispatcher.awaitIdle(Duration.ofSeconds(30))).isTrue();
    }

    @RepeatedTest(10)
    void 공유해제_PATCH와_본문만_PATCH가_겹쳐도_공유해제와_본문이_모두_남는다() throws Exception {
        long sessionId = insertCompletedSession(courseId);
        long postId = insertPost(sessionId, "원래 본문");

        List<String> results =
                runTogether(
                        List.of(
                                () -> {
                                    postService.update(userId, postId, courseSharedOnly(false));
                                    return "OK";
                                },
                                () -> {
                                    postService.update(userId, postId, bodyOnly("새 본문"));
                                    return "OK";
                                }));

        assertThat(results).containsExactly("OK", "OK");
        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT body, course_shared, deleted_at FROM posts WHERE id=?", postId);
        assertThat(row.get("course_shared")).isEqualTo(false);
        assertThat(row.get("body")).isEqualTo("새 본문");
        assertThat(row.get("deleted_at")).isNull();
    }

    @RepeatedTest(10)
    void PATCH와_S09가_겹쳐도_삭제된_게시물이_되살아나지_않는다() throws Exception {
        long sessionId = insertCompletedSession(courseId);
        long postId = insertPost(sessionId, "원래 본문");

        List<String> results =
                runTogether(
                        List.of(
                                () -> {
                                    postService.update(userId, postId, courseSharedOnly(false));
                                    return "OK";
                                },
                                () -> {
                                    runningSessionService.delete(userId, sessionId);
                                    return "OK";
                                }));

        // 수정이 늦으면 잠금 아래서 삭제를 보고 POST_NOT_FOUND. S09는 항상 성공한다.
        assertThat(results.get(0)).isIn("OK", "POST_NOT_FOUND");
        assertThat(results.get(1)).isEqualTo("OK");
        assertThat(deletedFlag("running_sessions", sessionId)).isTrue();
        assertThat(deletedFlag("posts", postId)).isTrue();
    }

    @RepeatedTest(10)
    void PATCH와_CMT05가_겹쳐도_삭제된_게시물이_되살아나지_않는다() throws Exception {
        long sessionId = insertCompletedSession(courseId);
        long postId = insertPost(sessionId, "원래 본문");

        List<String> results =
                runTogether(
                        List.of(
                                () -> {
                                    postService.update(userId, postId, bodyOnly("새 본문"));
                                    return "OK";
                                },
                                () -> {
                                    postService.delete(userId, postId);
                                    return "OK";
                                }));

        assertThat(results.get(0)).isIn("OK", "POST_NOT_FOUND");
        assertThat(results.get(1)).isEqualTo("OK");
        assertThat(deletedFlag("posts", postId)).isTrue();
    }

    private static UpdatePostRequest courseSharedOnly(boolean shared) {
        UpdatePostRequest request = new UpdatePostRequest();
        request.setCourseShared(shared);
        return request;
    }

    private static UpdatePostRequest bodyOnly(String body) {
        UpdatePostRequest request = new UpdatePostRequest();
        request.setBody(body);
        return request;
    }

    private boolean deletedFlag(String table, long id) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT deleted_at IS NOT NULL FROM " + table + " WHERE id=?",
                        Boolean.class,
                        id));
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
            // 실패로 빠져나와도 요청 스레드가 트랜잭션·잠금을 쥔 채 다음 테스트 정리와 겹치지 않도록 종료까지 기다린다.
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
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

    private long insertCompletedSession(long sessionCourseId) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(
                  user_id, status, state_version, control_device_id, relay_device_id,
                  analysis_status, started_at, course_id)
                VALUES (
                  ?, 'COMPLETED'::running_sessions_status_enum, 5, ?, ?,
                  'READY'::running_sessions_analysis_status_enum, now(), ?)
                RETURNING id
                """,
                Long.class,
                userId,
                watchId,
                phoneId,
                sessionCourseId);
    }

    private long insertPost(long sessionId, String body) {
        return jdbc.queryForObject(
                "INSERT INTO posts(author_id, session_id, body) VALUES (?, ?, ?) RETURNING id",
                Long.class,
                userId,
                sessionId,
                body);
    }
}
