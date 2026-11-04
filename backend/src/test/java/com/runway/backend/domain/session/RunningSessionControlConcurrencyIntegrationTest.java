package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.dto.request.SessionControlRequest;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.global.exception.ApiException;
import java.time.Instant;
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
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 같은 세션의 제어가 세션 행 잠금에서 실제로 겹치도록 서비스를 동시에 호출한다 — 작업 계획 AC-A12. 순차 재요청은 Result·Request 테스트가 다룬다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
@Import(EndedEventRecorder.class)
class RunningSessionControlConcurrencyIntegrationTest extends RunningSessionIntegrationSupport {

    private static final int THREADS = 8;
    private static final String T1 = "2026-10-28T01:00:01Z";

    @Autowired private RunningSessionControlService service;
    @Autowired private EndedEventRecorder recorder;

    @BeforeEach
    void clearEvents() {
        recorder.clear();
    }

    /** 성공은 "OK", 실패는 오류 코드로 돌려준다. RunningSessionConcurrencyIntegrationTest와 같은 방식이다. */
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

    private Callable<Object> control(long sessionId, ControlAction action, String body) {
        SessionControlRequest request = SessionControlRequest.fromJson(body, action);
        return () -> service.control(userId, sessionId, action, request, Instant.now());
    }

    private List<Callable<Object>> times(int n, Callable<Object> task) {
        List<Callable<Object>> tasks = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            tasks.add(task);
        }
        return tasks;
    }

    @RepeatedTest(10)
    void 같은_버전의_서로_다른_요청은_한쪽만_승인된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        List<Callable<Object>> tasks = new ArrayList<>();
        tasks.addAll(times(THREADS / 2, control(sessionId, ControlAction.PAUSE, requestBody(watchId, 2))));
        tasks.addAll(times(THREADS / 2, control(sessionId, ControlAction.END, requestBody(watchId, 2))));

        List<String> results = runTogether(tasks);

        List<String> pauses = results.subList(0, THREADS / 2);
        List<String> ends = results.subList(THREADS / 2, THREADS);
        boolean pauseWon = pauses.stream().allMatch("OK"::equals);
        boolean endWon = ends.stream().allMatch("OK"::equals);
        assertThat(pauseWon ^ endWon).as("한쪽 작업만 승인: %s", results).isTrue();
        assertThat(pauseWon ? ends : pauses).containsOnly("COMMAND_CONFLICT");
        assertThat(commandCount(sessionId)).isEqualTo(1);
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @RepeatedTest(10)
    void 같은_결과의_동시_재전송은_모두_성공하고_버전은_한번만_오른다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = insertCommand(sessionId, watchId, "START", 1, "PENDING");

        List<String> results =
                runTogether(
                        times(
                                THREADS,
                                control(
                                        sessionId,
                                        ControlAction.START,
                                        resultBody(commandId, watchId, "APPLIED", T1))));

        assertThat(results).containsOnly("OK");
        assertThat(stateVersion(sessionId)).isEqualTo(2);
        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
    }

    @RepeatedTest(10)
    void 적용과_거절의_동시_보고는_한쪽만_반영된다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = insertCommand(sessionId, watchId, "START", 1, "PENDING");
        List<Callable<Object>> tasks = new ArrayList<>();
        tasks.addAll(
                times(
                        THREADS / 2,
                        control(sessionId, ControlAction.START, resultBody(commandId, watchId, "APPLIED", T1))));
        tasks.addAll(
                times(
                        THREADS / 2,
                        control(sessionId, ControlAction.START, resultBody(commandId, watchId, "REJECTED", null))));

        List<String> results = runTogether(tasks);

        List<String> applied = results.subList(0, THREADS / 2);
        List<String> rejected = results.subList(THREADS / 2, THREADS);
        boolean appliedWon = applied.stream().allMatch("OK"::equals);
        boolean rejectedWon = rejected.stream().allMatch("OK"::equals);
        assertThat(appliedWon ^ rejectedWon).as("한쪽 결과만 반영: %s", results).isTrue();
        assertThat(appliedWon ? rejected : applied).containsOnly("COMMAND_CONFLICT");
        assertThat(stateVersion(sessionId)).isEqualTo(2);
        assertThat(sessionStatus(sessionId)).isEqualTo(appliedWon ? "RUNNING" : "READY");
    }

    @RepeatedTest(10)
    void 취소와_시작_요청이_겹치면_먼저_잠근_쪽만_반영된다() throws Exception {
        long sessionId = insertReadySession();
        List<Callable<Object>> tasks = new ArrayList<>();
        tasks.addAll(times(THREADS / 2, () -> service.cancel(userId, sessionId)));
        tasks.addAll(times(THREADS / 2, control(sessionId, ControlAction.START, requestBody(watchId, 1))));

        List<String> results = runTogether(tasks);

        List<String> cancels = results.subList(0, THREADS / 2);
        List<String> starts = results.subList(THREADS / 2, THREADS);
        if (sessionStatus(sessionId).equals("CANCELLED")) {
            assertThat(cancels).containsOnly("OK");
            assertThat(starts).containsOnly("INVALID_SESSION_STATE");
            assertThat(commandCount(sessionId)).isZero();
            assertThat(stateVersion(sessionId)).isEqualTo(2);
        } else {
            assertThat(sessionStatus(sessionId)).isEqualTo("READY");
            assertThat(starts).containsOnly("OK");
            assertThat(cancels).containsOnly("COMMAND_PENDING");
            assertThat(commandCount(sessionId)).isEqualTo(1);
            assertThat(stateVersion(sessionId)).isEqualTo(1);
        }
    }

    @RepeatedTest(10)
    void 종료_결과_동시_재전송은_종료_이벤트를_한번만_보낸다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 4, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = TIMESTAMPTZ '2026-10-28T00:00:00Z' WHERE id=?",
                sessionId);
        long commandId = insertCommand(sessionId, watchId, "END", 4, "PENDING");
        String body =
                resultBody(commandId, watchId, "APPLIED", T1).replace("}", ",\"uploadComplete\":true}");

        List<String> results = runTogether(times(THREADS, control(sessionId, ControlAction.END, body)));

        assertThat(results).containsOnly("OK");
        assertThat(stateVersion(sessionId)).isEqualTo(5);
        assertThat(recorder.events()).hasSize(1);
    }
}
