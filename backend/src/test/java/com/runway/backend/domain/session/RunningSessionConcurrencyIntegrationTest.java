package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.dto.request.CreateRunningSessionRequest;
import com.runway.backend.domain.session.dto.request.UpdateRunningSessionRequest;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.global.exception.ApiException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

/**
 * AC-5·AC-19. 경합 사례는 각 10회 반복한다. 목표 변경과 시작 미확인 중단은 선행 조건이 서로 배타적이라 경합 사례에서 제외했다(플랜 8장).
 * 동시에 출발시킨 요청이 실제 DB 트랜잭션에서 겹치도록 실행하고 응답 코드와 최종 DB 상태로 판정한다. 단일 서버·단일 DB 범위의 확인이다.
 */
@Testcontainers
class RunningSessionConcurrencyIntegrationTest extends RunningSessionIntegrationSupport {

    private static final int THREADS = 8;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Autowired private RunningSessionService service;
    @Autowired private DataSource dataSource;
    @Autowired private SessionReferenceRepository referenceRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    /** 성공은 "OK", 실패는 오류 코드로 돌려준다. */
    private List<String> runTogether(List<Callable<Object>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<String>> futures = new ArrayList<>();
            for (Callable<Object> task : tasks) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    try {
                                        task.call();
                                        return "OK";
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

    private static <T> List<Callable<Object>> repeat(Callable<Object> task) {
        List<Callable<Object>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            tasks.add(task);
        }
        return tasks;
    }

    private UpdateRunningSessionRequest patch(String body) {
        return UpdateRunningSessionRequest.from(JSON.readTree(body));
    }

    @RepeatedTest(10)
    void 같은_회원의_동시_생성은_하나만_성공한다() throws Exception {
        CreateRunningSessionRequest request =
                CreateRunningSessionRequest.from(JSON.readTree("{" + devices() + "}"));
        List<String> results =
                runTogether(repeat(() -> service.create(userId, request, Instant.now())));

        assertThat(results.stream().filter("OK"::equals)).hasSize(1);
        assertThat(results.stream().filter("ACTIVE_SESSION_EXISTS"::equals)).hasSize(THREADS - 1);
        assertThat(count("SELECT count(*) FROM running_sessions WHERE user_id=?", userId)).isEqualTo(1);
    }

    @RepeatedTest(10)
    void 같은_버전의_서로_다른_목표_변경은_하나만_반영된다() throws Exception {
        long sessionId = insertReadySession();
        AtomicInteger distance = new AtomicInteger(1000);
        List<Callable<Object>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            int target = distance.addAndGet(500);
            tasks.add(
                    () ->
                            service.update(
                                    userId,
                                    sessionId,
                                    patch(
                                            "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,"
                                                    + "\"targetDistanceM\":" + target + "}"),
                                    Instant.now()));
        }
        List<String> results = runTogether(tasks);

        assertThat(results.stream().filter("OK"::equals)).hasSize(1);
        assertThat(results.stream().filter("STALE_STATE"::equals)).hasSize(THREADS - 1);
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @RepeatedTest(10)
    void 동시_중단_재요청은_모두_성공하고_버전은_한번만_오른다() throws Exception {
        long sessionId = insertReadySession();
        insertCommand(sessionId, watchId, "START", 1, "PENDING");
        UpdateRunningSessionRequest request =
                patch(
                        "{\"operation\":\"ABORT_UNCONFIRMED_START\",\"deviceId\":" + phoneId
                                + ",\"expectedVersion\":1}");
        List<String> results =
                runTogether(repeat(() -> service.update(userId, sessionId, request, Instant.now())));

        assertThat(results).containsOnly("OK");
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @RepeatedTest(10)
    void 동시_인계_재요청은_모두_성공하고_한번만_반영된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, watchId, phoneId, "PENDING", null);
        insertCommand(sessionId, watchId, "PAUSE", 5, "PENDING");
        UpdateRunningSessionRequest request =
                patch(
                        "{\"operation\":\"TAKE_OVER_PHONE\",\"deviceId\":" + phoneId
                                + ",\"expectedVersion\":5,\"receivedWatchBatchesUploaded\":true}");
        List<String> results =
                runTogether(repeat(() -> service.update(userId, sessionId, request, Instant.now())));

        assertThat(results).containsOnly("OK");
        assertThat(stateVersion(sessionId)).isEqualTo(6);
        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events WHERE result='UNKNOWN'"
                                        + " AND reason_code='WATCH_DISCONNECTED'"))
                .isEqualTo(1);
    }

    /** 삭제와 비교 기록 선택이 겹치면 어느 순서든 교착 없이 끝나며, 삭제는 항상 성공한다. */
    @RepeatedTest(10)
    void 비교기록_삭제와_그_기록을_비교하는_생성이_겹친다() throws Exception {
        long course = insertCourse("ACTIVE", "5000");
        long comparison = insertSession(userId, "COMPLETED", 3, watchId, phoneId, "READY", course);
        CreateRunningSessionRequest create =
                CreateRunningSessionRequest.from(
                        JSON.readTree(
                                "{" + devices() + ",\"courseId\":" + course + ",\"comparisonSessionId\":"
                                        + comparison + "}"));
        List<String> results =
                runTogether(
                        List.of(
                                () -> service.delete(userId, comparison),
                                () -> service.create(userId, create, Instant.now())));

        assertThat(results.get(0)).isEqualTo("OK");
        assertThat(results.get(1)).isIn("OK", "INVALID_COMPARISON_SESSION");
        int created = count("SELECT count(*) FROM running_sessions WHERE comparison_session_id=?", comparison);
        assertThat(created).isEqualTo("OK".equals(results.get(1)) ? 1 : 0);
    }

    /** B-5. 비교 기록 잠금은 본인 세션에만 걸리므로 서로의 READY 세션을 지정해도 교착 상태(500) 없이 둘 다 422다. */
    @RepeatedTest(10)
    void 서로의_세션을_비교기록으로_지정해도_교착없이_거절된다() throws Exception {
        long course = insertCourse("ACTIVE", "5000");
        long mine = insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", course);
        long theirs = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", course);
        String goal = "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"comparisonSessionId\":";
        List<String> results =
                runTogether(
                        List.of(
                                () -> service.update(userId, mine, patch(goal + theirs + "}"), Instant.now()),
                                () ->
                                        service.update(
                                                otherUserId, theirs, patch(goal + mine + "}"), Instant.now())));

        assertThat(results).containsOnly("INVALID_COMPARISON_SESSION");
        assertThat(stateVersion(mine)).isEqualTo(1);
        assertThat(stateVersion(theirs)).isEqualTo(1);
    }

    /** A-3/B-1. 세션 잠금을 기다리는 사이 그룹에 연결되면 잠금 전 판단을 쓰지 않고 다시 조회하게 한다. */
    @Test
    void 잠금을_기다리는_사이_그룹에_연결되면_목표변경은_STALE_STATE다() throws Exception {
        long sessionId = insertReadySession();
        String result =
                linkGroupWhileLocked(
                        sessionId,
                        "SCHEDULED",
                        () ->
                                service.update(
                                        userId,
                                        sessionId,
                                        patch(
                                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,"
                                                        + "\"targetDistanceM\":5000}"),
                                        Instant.now()));

        assertThat(result).isEqualTo("STALE_STATE");
        assertThat(stateVersion(sessionId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_sessions WHERE id=? AND goal_distance IS NULL", sessionId))
                .isEqualTo(1);
    }

    /** 종료·분석 완료 그룹이라 재확인이 없으면 삭제가 성공한다. 그룹 미종료 거절과 같은 코드로 우연히 통과하지 않게 한다. */
    @Test
    void 잠금을_기다리는_사이_그룹에_연결되면_삭제는_INVALID_STATE다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 3, watchId, phoneId, "READY", null);
        String result =
                linkGroupWhileLocked(
                        sessionId, "COMPLETED", () -> service.delete(userId, sessionId));

        assertThat(result).isEqualTo("INVALID_STATE");
        assertThat(count("SELECT count(*) FROM running_sessions WHERE id=? AND deleted_at IS NULL", sessionId))
                .isEqualTo(1);
    }

    /** 다른 트랜잭션이 세션 행을 잠근 동안 요청을 출발시키고, 요청이 잠금을 기다리기 시작하면 그룹 연결을 저장한 뒤 잠금을 푼다. */
    private String linkGroupWhileLocked(long sessionId, String groupStatus, Callable<Object> request)
            throws Exception {
        long groupRunId = insertGroupRun(groupStatus, "COMPLETED".equals(groupStatus));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            int holderPid;
            try (PreparedStatement pid = holder.prepareStatement("SELECT pg_backend_pid()");
                    var rs = pid.executeQuery()) {
                rs.next();
                holderPid = rs.getInt(1);
            }
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM running_sessions WHERE id=? FOR UPDATE")) {
                lock.setLong(1, sessionId);
                lock.executeQuery().close();
            }
            Future<String> future =
                    pool.submit(
                            () -> {
                                try {
                                    request.call();
                                    return "OK";
                                } catch (ApiException ex) {
                                    return ex.code();
                                }
                            });
            awaitBlockedBy(holderPid);
            try (PreparedStatement link =
                    holder.prepareStatement(
                            "INSERT INTO group_run_participants(group_run_id,user_id,session_id) VALUES (?,?,?)")) {
                link.setLong(1, groupRunId);
                link.setLong(2, userId);
                link.setLong(3, sessionId);
                link.executeUpdate();
            }
            holder.commit();
            return future.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    /** W03 해제가 커밋되기 전에 생성이 들어오면 기기 행 잠금을 기다렸다가 해제된 상태를 읽고 거절한다. */
    @Test
    void 기기_해제와_겹친_생성은_해제_확정을_기다려_DEVICE_FORBIDDEN이다() throws Exception {
        CreateRunningSessionRequest request =
                CreateRunningSessionRequest.from(JSON.readTree("{" + devices() + "}"));
        String result =
                runWhileHolding(
                        "UPDATE user_devices SET unlinked_at=now() WHERE id=" + watchId,
                        () -> service.create(userId, request, Instant.now()));

        assertThat(result).isEqualTo("DEVICE_FORBIDDEN");
        assertThat(count("SELECT count(*) FROM running_sessions WHERE user_id=?", userId)).isZero();
    }

    /** 코스 상태 변경이 커밋되기 전에 생성이 들어오면 코스 행 잠금을 기다렸다가 바뀐 상태로 거절한다. */
    @Test
    void 코스_차단과_겹친_생성은_차단_확정을_기다려_COURSE_INACCESSIBLE이다() throws Exception {
        long course = insertCourse("ACTIVE", "5000");
        CreateRunningSessionRequest request =
                CreateRunningSessionRequest.from(
                        JSON.readTree("{" + devices() + ",\"courseId\":" + course + "}"));
        String result =
                runWhileHolding(
                        "UPDATE courses SET status='BLOCKED' WHERE id=" + course,
                        () -> service.create(userId, request, Instant.now()));

        assertThat(result).isEqualTo("COURSE_INACCESSIBLE");
        assertThat(count("SELECT count(*) FROM running_sessions WHERE user_id=?", userId)).isZero();
    }

    /** 세션 변경·삭제가 그룹 행을 잠근 동안에도 같은 그룹의 참가 행 INSERT(FK 검사)는 기다리지 않는다. */
    @Test
    void 그룹_행_잠금은_같은_그룹_참가_신청을_막지_않는다() {
        long groupRunId = insertGroupRun("SCHEDULED", false);
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        status -> {
                            assertThat(referenceRepository.lockGroupRun(groupRunId)).isPresent();
                            try (Connection other = dataSource.getConnection();
                                    Statement statement = other.createStatement()) {
                                statement.execute("SET lock_timeout = '2s'");
                                statement.executeUpdate(
                                        "INSERT INTO group_run_participants(group_run_id,user_id) VALUES ("
                                                + groupRunId
                                                + ","
                                                + otherUserId
                                                + ")");
                            } catch (Exception ex) {
                                throw new AssertionError("참가 행 INSERT가 그룹 행 잠금에 막혔다", ex);
                            }
                        });

        assertThat(
                        count(
                                "SELECT count(*) FROM group_run_participants WHERE group_run_id=? AND user_id=?",
                                groupRunId,
                                otherUserId))
                .isEqualTo(1);
    }

    /** 다른 트랜잭션이 holderSql로 행을 바꾼 채 커밋하지 않은 동안 요청을 출발시키고, 요청이 그 잠금을 기다리기 시작하면 커밋한다. */
    private String runWhileHolding(String holderSql, Callable<Object> request) throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            int holderPid;
            try (PreparedStatement pid = holder.prepareStatement("SELECT pg_backend_pid()");
                    var rs = pid.executeQuery()) {
                rs.next();
                holderPid = rs.getInt(1);
            }
            try (Statement statement = holder.createStatement()) {
                assertThat(statement.executeUpdate(holderSql)).isEqualTo(1);
            }
            Future<String> future =
                    pool.submit(
                            () -> {
                                try {
                                    request.call();
                                    return "OK";
                                } catch (ApiException ex) {
                                    return ex.code();
                                }
                            });
            awaitBlockedBy(holderPid);
            holder.commit();
            return future.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    /** 다른 테스트의 대기 잠금이 아니라 holder가 막고 있는 요청이 생길 때까지 기다린다. */
    private void awaitBlockedBy(int holderPid) throws InterruptedException {
        for (int i = 0; i < 400; i++) {
            if (count(
                            "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))",
                            holderPid)
                    > 0) {
                return;
            }
            Thread.sleep(25);
        }
        throw new AssertionError("요청이 세션 잠금을 기다리기 시작하지 않았다");
    }
}
