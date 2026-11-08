package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.dto.request.SessionBpmRequest;
import com.runway.backend.domain.session.dto.request.SessionControlRequest;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.domain.session.service.SessionBpmService;
import com.runway.backend.domain.session.service.SessionCoachingService;
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
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * P07·서버 코칭이 다른 제어와 세션 행 잠금에서 실제로 겹치도록 동시에 호출한다 — 작업 계획 AC-12. 순차 재요청은 SessionBpmIntegrationTest가
 * 다룬다.
 */
@Testcontainers
class SessionBpmConcurrencyIntegrationTest extends RunningSessionIntegrationSupport {

    private static final int THREADS = 8;
    private static final String T1 = "2026-10-28T01:00:01Z";

    @Autowired private SessionBpmService bpmService;
    @Autowired private RunningSessionControlService controlService;
    @Autowired private SessionCoachingService coachingService;

    /** 성공은 "OK", 실패는 오류 코드, 코칭 미발행은 "NONE"으로 돌려준다. */
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
                                        Object result = task.call();
                                        return result instanceof java.util.Optional<?> o && o.isEmpty()
                                                ? "NONE"
                                                : "OK";
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

    private Callable<Object> bpm(long sessionId, String body) {
        SessionBpmRequest request = SessionBpmRequest.fromJson(body);
        return () -> bpmService.control(userId, sessionId, request, Instant.now());
    }

    private static List<Callable<Object>> times(int n, Callable<Object> task) {
        List<Callable<Object>> tasks = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            tasks.add(task);
        }
        return tasks;
    }

    @RepeatedTest(5)
    void 같은_버전의_서로_다른_BPM_요청은_한쪽만_승인된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        List<Callable<Object>> tasks = new ArrayList<>();
        tasks.addAll(times(THREADS / 2, bpm(sessionId, bpmRequestBody(watchId, 2, 165))));
        tasks.addAll(times(THREADS / 2, bpm(sessionId, bpmRequestBody(watchId, 2, 170))));

        List<String> results = runTogether(tasks);

        List<String> first = results.subList(0, THREADS / 2);
        List<String> second = results.subList(THREADS / 2, THREADS);
        boolean firstWon = first.stream().allMatch("OK"::equals);
        boolean secondWon = second.stream().allMatch("OK"::equals);
        assertThat(firstWon ^ secondWon).as("한쪽만 승인: %s", results).isTrue();
        assertThat(firstWon ? second : first).containsOnly("COMMAND_CONFLICT");
        assertThat(commandCount(sessionId)).isEqualTo(1);
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @RepeatedTest(5)
    void BPM_요청과_일시정지_요청이_겹치면_하나만_승인된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        SessionControlRequest pause =
                SessionControlRequest.fromJson(requestBody(watchId, 2), ControlAction.PAUSE);
        List<Callable<Object>> tasks = new ArrayList<>();
        tasks.addAll(times(THREADS / 2, bpm(sessionId, bpmRequestBody(watchId, 2, 165))));
        tasks.addAll(
                times(
                        THREADS / 2,
                        () ->
                                controlService.control(
                                        userId, sessionId, ControlAction.PAUSE, pause, Instant.now())));

        List<String> results = runTogether(tasks);

        assertThat(results.stream().filter("OK"::equals).count()).isEqualTo(THREADS / 2);
        assertThat(results).containsOnly("OK", "COMMAND_CONFLICT");
        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @RepeatedTest(5)
    void 같은_결과의_동시_재전송은_버전을_한번만_올린다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        long commandId =
                Long.parseLong(
                        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                                .andReturn()
                                .getResponse()
                                .getContentAsString()
                                .replaceAll(".*\"commandId\":(\\d+).*", "$1"));

        List<String> results =
                runTogether(
                        times(THREADS, bpm(sessionId, resultBody(commandId, watchId, "APPLIED", T1))));

        assertThat(results).containsOnly("OK");
        assertThat(stateVersion(sessionId)).isEqualTo(3);
        assertThat(currentBpm(sessionId)).isEqualTo(165);
    }

    @RepeatedTest(5)
    void 코칭_발행이_동시에_여러번_판단돼도_한_건만_만든다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 180);

        List<String> results =
                runTogether(times(THREADS, () -> coachingService.issueIfDue(sessionId)));

        assertThat(results.stream().filter("OK"::equals).count()).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId))
                .isEqualTo(1);
        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @RepeatedTest(5)
    void 코칭_발행과_수동_BPM_요청이_겹치면_하나만_명령이_된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 180);
        List<Callable<Object>> tasks = new ArrayList<>();
        tasks.addAll(times(THREADS / 2, () -> coachingService.issueIfDue(sessionId)));
        tasks.addAll(times(THREADS / 2, bpm(sessionId, bpmRequestBody(watchId, 2, 165))));

        List<String> results = runTogether(tasks);

        assertThat(commandCount(sessionId)).isEqualTo(1);
        assertThat(results).doesNotContain("INTERNAL_ERROR");
        String action =
                jdbc.queryForObject(
                        "SELECT action::text FROM session_control_events WHERE session_id=?",
                        String.class,
                        sessionId);
        if (action.equals("COACHING")) {
            assertThat(results.subList(THREADS / 2, THREADS))
                    .containsOnly("COMMAND_CONFLICT");
        } else {
            assertThat(results.subList(0, THREADS / 2)).containsOnly("NONE");
            assertThat(count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId))
                    .isZero();
        }
    }
}
