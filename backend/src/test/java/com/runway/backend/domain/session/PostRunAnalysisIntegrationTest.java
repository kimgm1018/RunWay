package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import com.runway.backend.domain.session.service.PostRunAnalysisDispatcher;
import com.runway.backend.domain.session.service.PostRunAnalysisRecovery;
import com.runway.backend.domain.session.service.PostRunAnalysisService;
import com.runway.backend.domain.session.service.PostRunAnalysisService.Outcome;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 종료 후 분석(S15P31E105-312) 통합 테스트. 모든 값은 합성 데이터이며 실제 건강·GPS 정보를 쓰지 않는다.
 *
 * <p>분석은 종료 이벤트 커밋 뒤 전용 실행기에서 돌므로 이벤트를 커밋하는 트랜잭션으로 발행하고 {@link
 * PostRunAnalysisDispatcher#awaitIdle(Duration)}로 끝나기를 기다린 뒤 DB를 확인한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class PostRunAnalysisIntegrationTest extends RunningSessionIntegrationSupport {

    private static final Instant START = Instant.parse("2026-10-28T01:00:00Z");

    @Autowired private ApplicationEventPublisher publisher;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private PostRunAnalysisDispatcher dispatcher;
    @Autowired private PostRunAnalysisService analysisService;
    @Autowired private PostRunAnalysisRecovery recovery;

    /** 샘플·구간은 세션을 지우기 전에 먼저 지워야 하므로(FK) 베이스의 데이터 초기화 앞에서 정리한다. */
    @AfterEach
    void cleanAnalysisData() throws InterruptedException {
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
        jdbc.update("DELETE FROM running_session_splits");
        jdbc.update("DELETE FROM running_metric_samples");
    }

    // ---------- 준비 ----------

    private static Instant at(long secondsFromStart) {
        return START.plusSeconds(secondsFromStart);
    }

    /** 종료가 확정된(COMPLETED) 분석 대기 세션. 종료시각이 null이면 분석 입력이 부족한 세션이 된다. */
    private long completedSession(
            long endSecFromStart, Integer goalDistance, Integer goalDuration, boolean withEnd) {
        long sessionId = insertSession(userId, "COMPLETED", 5, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = CAST(? AS timestamptz),"
                        + " ended_at = CAST(? AS timestamptz),"
                        + " goal_distance = CAST(? AS integer), goal_duration = CAST(? AS integer)"
                        + " WHERE id = ?",
                START.toString(),
                withEnd ? at(endSecFromStart).toString() : null,
                goalDistance == null ? null : goalDistance.toString(),
                goalDuration == null ? null : goalDuration.toString(),
                sessionId);
        return sessionId;
    }

    private long completedSession(long endSecFromStart) {
        return completedSession(endSecFromStart, null, null, true);
    }

    private void sample(long sessionId, long sec, String distance, String hr, String cadence) {
        jdbc.update(
                "INSERT INTO running_metric_samples(running_session_id, device_id, measured_at,"
                        + " elapsed_duration, heart_rate, cadence, total_distance, route_progress,"
                        + " is_hr_measured)"
                        + " VALUES (?, ?, CAST(? AS timestamptz), ?, CAST(? AS numeric),"
                        + " CAST(? AS numeric), CAST(? AS numeric), 0, ?)",
                sessionId,
                watchId,
                at(sec).toString(),
                (int) sec,
                hr,
                cadence,
                distance,
                hr != null);
    }

    private void pauseEvent(long sessionId, String action, long version, String result, Long sec) {
        jdbc.update(
                "INSERT INTO session_control_events(session_id, device_id, action, expected_version,"
                        + " result, applied_at)"
                        + " VALUES (?, ?, ?::session_control_events_action_enum, ?,"
                        + " ?::session_control_events_result_enum, CAST(? AS timestamptz))",
                sessionId,
                watchId,
                action,
                version,
                result,
                sec == null ? null : at(sec).toString());
    }

    /** 이벤트를 커밋하는 트랜잭션에서 발행해 AFTER_COMMIT 소비자가 실제 경로로 실행되게 한다. */
    private void publishEnded(long sessionId) throws InterruptedException {
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        tx ->
                                publisher.publishEvent(
                                        new PersonalSessionEndedEvent(sessionId, null, at(1800))));
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(15))).isTrue();
    }

    private Map<String, Object> session(long sessionId) {
        return jdbc.queryForMap(
                "SELECT analysis_status::text AS analysis_status, state_version, total_distance,"
                        + " moving_duration, elapsed_duration, moving_duration_to_goal, goal_achieved,"
                        + " average_pace, average_heart_rate, average_cadence, max_heart_rate"
                        + " FROM running_sessions WHERE id = ?",
                sessionId);
    }

    private List<Map<String, Object>> splits(long sessionId) {
        return jdbc.queryForList(
                "SELECT id, start_distance, end_distance, pace, average_heart_rate, average_cadence"
                        + " FROM running_session_splits WHERE running_session_id = ?"
                        + " ORDER BY start_distance",
                sessionId);
    }

    private static BigDecimal num(Map<String, Object> row, String column) {
        return (BigDecimal) row.get(column);
    }

    private String analysisStatus(long sessionId) {
        return (String) session(sessionId).get("analysis_status");
    }

    /** 0~2.5km를 달리는 합성 기록. 마지막 500m는 100초에 달린다. */
    private void insertTwoAndHalfKm(long sessionId) {
        sample(sessionId, 0, "0", "140", "170");
        sample(sessionId, 150, "500", "150", "170");
        sample(sessionId, 300, "1000", "160", "170");
        sample(sessionId, 450, "1500", "170", "170");
        sample(sessionId, 600, "2000", "180", "170");
        sample(sessionId, 700, "2500", "190", "170");
    }

    // ---------- 정상 경로 ----------

    @Test
    void 종료_이벤트를_받으면_통계와_1km_구간이_저장되고_READY가_된다() throws Exception {
        long sessionId = completedSession(700);
        insertTwoAndHalfKm(sessionId);
        // 이전에 저장된 값은 가산되지 않고 덮어써진다.
        jdbc.update(
                "UPDATE running_sessions SET total_distance = 99999, average_pace = 1 WHERE id = ?",
                sessionId);
        jdbc.update(
                "INSERT INTO running_session_splits(running_session_id, start_distance, end_distance,"
                        + " pace) VALUES (?, 0, 1000, 999)",
                sessionId);

        publishEnded(sessionId);

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("READY");
        assertThat(((Number) row.get("state_version")).longValue()).isEqualTo(6);
        assertThat(num(row, "total_distance")).isEqualByComparingTo("2500");
        assertThat(((Number) row.get("elapsed_duration")).intValue()).isEqualTo(700);
        assertThat(((Number) row.get("moving_duration")).intValue()).isEqualTo(700);
        assertThat(num(row, "average_pace")).isEqualByComparingTo("280");
        assertThat(num(row, "average_heart_rate")).isEqualByComparingTo("165");
        assertThat(num(row, "max_heart_rate")).isEqualByComparingTo("190");
        assertThat(num(row, "average_cadence")).isEqualByComparingTo("170");
        assertThat(row.get("moving_duration_to_goal")).isNull();
        assertThat(row.get("goal_achieved")).isNull();

        List<Map<String, Object>> rows = splits(sessionId);
        assertThat(rows).hasSize(3);
        assertThat(num(rows.get(0), "start_distance")).isEqualByComparingTo("0");
        assertThat(num(rows.get(0), "end_distance")).isEqualByComparingTo("1000");
        assertThat(num(rows.get(0), "pace")).isEqualByComparingTo("300");
        assertThat(num(rows.get(0), "average_heart_rate")).isEqualByComparingTo("150");
        assertThat(num(rows.get(1), "start_distance")).isEqualByComparingTo("1000");
        assertThat(num(rows.get(1), "end_distance")).isEqualByComparingTo("2000");
        assertThat(num(rows.get(1), "pace")).isEqualByComparingTo("300");
        assertThat(num(rows.get(1), "average_heart_rate")).isEqualByComparingTo("175");
        // 짧은 마지막 구간도 버리지 않는다.
        assertThat(num(rows.get(2), "start_distance")).isEqualByComparingTo("2000");
        assertThat(num(rows.get(2), "end_distance")).isEqualByComparingTo("2500");
        assertThat(num(rows.get(2), "pace")).isEqualByComparingTo("200");
        assertThat(num(rows.get(2), "average_heart_rate")).isEqualByComparingTo("190");
        assertThat(num(rows.get(2), "average_cadence")).isEqualByComparingTo("170");
    }

    @Test
    void 목표_거리와_시간이_있으면_도달_운동시간과_달성_여부를_저장한다() throws Exception {
        long sessionId = completedSession(700, 2000, 700, true);
        insertTwoAndHalfKm(sessionId);

        publishEnded(sessionId);

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("READY");
        assertThat(((Number) row.get("moving_duration_to_goal")).intValue()).isEqualTo(600);
        assertThat(row.get("goal_achieved")).isEqualTo(true);
    }

    @Test
    void 일킬로미터_미만_러닝은_구간_하나이고_실제_거리까지다() throws Exception {
        long sessionId = completedSession(180);
        sample(sessionId, 0, "0", "130", "160");
        sample(sessionId, 90, "300", "135", "160");
        sample(sessionId, 180, "600", "140", "160");

        publishEnded(sessionId);

        assertThat(analysisStatus(sessionId)).isEqualTo("READY");
        List<Map<String, Object>> rows = splits(sessionId);
        assertThat(rows).hasSize(1);
        assertThat(num(rows.get(0), "start_distance")).isEqualByComparingTo("0");
        assertThat(num(rows.get(0), "end_distance")).isEqualByComparingTo("600");
        assertThat(num(rows.get(0), "pace")).isEqualByComparingTo("300");
        assertThat(num(session(sessionId), "total_distance")).isEqualByComparingTo("600");
    }

    @Test
    void 일시정지_구간은_운동시간과_페이스에서_빠지고_거절된_PAUSE는_무시한다() throws Exception {
        long sessionId = completedSession(700);
        sample(sessionId, 0, "0", null, null);
        sample(sessionId, 300, "1000", null, null);
        sample(sessionId, 400, "1000", null, null);
        sample(sessionId, 500, "1500", null, null);
        sample(sessionId, 700, "2000", null, null);
        pauseEvent(sessionId, "PAUSE", 2, "REJECTED", null);
        pauseEvent(sessionId, "PAUSE", 3, "APPLIED", 300L);
        pauseEvent(sessionId, "RESUME", 4, "APPLIED", 400L);

        publishEnded(sessionId);

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("READY");
        assertThat(((Number) row.get("elapsed_duration")).intValue()).isEqualTo(700);
        assertThat(((Number) row.get("moving_duration")).intValue()).isEqualTo(600);
        assertThat(num(row, "average_pace")).isEqualByComparingTo("300");
        List<Map<String, Object>> rows = splits(sessionId);
        assertThat(rows).hasSize(2);
        assertThat(num(rows.get(1), "pace")).isEqualByComparingTo("300");
    }

    @Test
    void 미측정_심박과_케이던스는_0이_아니라_NULL로_저장한다() throws Exception {
        long sessionId = completedSession(600);
        sample(sessionId, 0, "0", null, null);
        sample(sessionId, 300, "1000", null, null);
        sample(sessionId, 600, "2000", null, null);

        publishEnded(sessionId);

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("READY");
        assertThat(row.get("average_heart_rate")).isNull();
        assertThat(row.get("average_cadence")).isNull();
        assertThat(row.get("max_heart_rate")).isNull();
        assertThat(splits(sessionId))
                .hasSize(2)
                .allSatisfy(
                        split -> {
                            assertThat(split.get("average_heart_rate")).isNull();
                            assertThat(split.get("average_cadence")).isNull();
                        });
    }

    // ---------- 중복·선점 ----------

    @Test
    void 같은_종료_이벤트가_다시_와도_한번만_반영한다() throws Exception {
        long sessionId = completedSession(700);
        insertTwoAndHalfKm(sessionId);

        publishEnded(sessionId);
        List<Map<String, Object>> firstSplits = splits(sessionId);
        long versionAfterFirst = ((Number) session(sessionId).get("state_version")).longValue();

        publishEnded(sessionId);
        publishEnded(sessionId);

        assertThat(analysisStatus(sessionId)).isEqualTo("READY");
        assertThat(((Number) session(sessionId).get("state_version")).longValue())
                .isEqualTo(versionAfterFirst)
                .isEqualTo(6);
        List<Map<String, Object>> after = splits(sessionId);
        assertThat(after).hasSize(3);
        // 구간 행이 다시 만들어지지 않았다.
        assertThat(after.stream().map(r -> r.get("id")).toList())
                .isEqualTo(firstSplits.stream().map(r -> r.get("id")).toList());
        assertThat(count("SELECT count(*) FROM running_session_splits WHERE running_session_id=?", sessionId))
                .isEqualTo(3);
    }

    @Test
    void 같은_세션을_동시에_분석해도_한_경로만_계산한다() throws Exception {
        long sessionId = completedSession(700);
        insertTwoAndHalfKm(sessionId);

        int callers = 4;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch ready = new CountDownLatch(callers);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < callers; i++) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    go.await();
                                    return analysisService.analyze(sessionId);
                                }));
            }
            ready.await();
            go.countDown();
            List<Outcome> outcomes = new ArrayList<>();
            for (Future<Outcome> future : futures) {
                outcomes.add(future.get());
            }
            assertThat(outcomes.stream().filter(o -> o == Outcome.READY).count()).isEqualTo(1);
            assertThat(outcomes.stream().filter(o -> o == Outcome.SKIPPED).count())
                    .isEqualTo(callers - 1);
        } finally {
            pool.shutdownNow();
        }

        assertThat(analysisStatus(sessionId)).isEqualTo("READY");
        assertThat(((Number) session(sessionId).get("state_version")).longValue()).isEqualTo(6);
        assertThat(splits(sessionId)).hasSize(3);
    }

    @Test
    void 종료되지_않은_세션이나_종료_후_이미_끝난_분석은_상태를_바꾸지_않는다() throws Exception {
        long running = insertSession(userId, "RUNNING", 4, watchId, phoneId, "PENDING", null);
        long failed = completedSession(600);
        jdbc.update(
                "UPDATE running_sessions SET analysis_status = 'FAILED' WHERE id = ?", failed);
        sample(failed, 0, "0", null, null);
        sample(failed, 600, "1000", null, null);

        publishEnded(running);
        publishEnded(failed);
        publishEnded(Long.MAX_VALUE - 1); // 없는 세션

        assertThat(analysisStatus(running)).isEqualTo("PENDING");
        assertThat(((Number) session(running).get("state_version")).longValue()).isEqualTo(4);
        // FAILED는 자동으로 다시 분석하지 않는다.
        assertThat(analysisStatus(failed)).isEqualTo("FAILED");
        assertThat(splits(failed)).isEmpty();
        assertThat(((Number) session(failed).get("state_version")).longValue()).isEqualTo(5);
    }

    // ---------- 빈 입력·실패 ----------

    @Test
    void 샘플이_없으면_거리_통계는_NULL이고_구간_없이_READY가_된다() throws Exception {
        long sessionId = completedSession(600);

        publishEnded(sessionId);

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("READY");
        assertThat(((Number) row.get("state_version")).longValue()).isEqualTo(6);
        assertThat(row.get("total_distance")).isNull();
        assertThat(row.get("average_pace")).isNull();
        assertThat(row.get("average_heart_rate")).isNull();
        assertThat(row.get("average_cadence")).isNull();
        assertThat(row.get("max_heart_rate")).isNull();
        // 시간은 실제 시작·종료시각에서 계산된다.
        assertThat(((Number) row.get("elapsed_duration")).intValue()).isEqualTo(600);
        assertThat(((Number) row.get("moving_duration")).intValue()).isEqualTo(600);
        assertThat(splits(sessionId)).isEmpty();
    }

    @Test
    void 종료시각이_없어_계산할_수_없으면_FAILED이고_통계와_구간을_남기지_않는다() throws Exception {
        long sessionId = completedSession(0, null, null, false);
        sample(sessionId, 0, "0", "140", "170");
        sample(sessionId, 300, "1000", "150", "170");

        publishEnded(sessionId);

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("FAILED");
        assertThat(((Number) row.get("state_version")).longValue()).isEqualTo(6);
        assertThat(row.get("total_distance")).isNull();
        assertThat(row.get("average_pace")).isNull();
        assertThat(row.get("moving_duration")).isNull();
        assertThat(splits(sessionId)).isEmpty();

        // 실패는 자동으로 다시 시도되지 않는다.
        publishEnded(sessionId);
        assertThat(analysisStatus(sessionId)).isEqualTo("FAILED");
        assertThat(((Number) session(sessionId).get("state_version")).longValue()).isEqualTo(6);
    }

    // ---------- 기동 복구 ----------

    @Test
    void 기동_복구는_남아_있는_PROCESSING만_FAILED로_바꾸고_다시_분석하지_않는다() throws Exception {
        long processing = completedSession(600);
        jdbc.update("UPDATE running_sessions SET analysis_status = 'PROCESSING' WHERE id = ?", processing);
        sample(processing, 0, "0", null, null);
        sample(processing, 600, "1000", null, null);
        long pending = completedSession(600);
        long ready = completedSession(600);
        jdbc.update("UPDATE running_sessions SET analysis_status = 'READY' WHERE id = ?", ready);
        long legacy = insertSession(userId, "COMPLETED", 0, watchId, phoneId, "LEGACY", null);

        recovery.run(null);
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();

        assertThat(analysisStatus(processing)).isEqualTo("FAILED");
        assertThat(((Number) session(processing).get("state_version")).longValue()).isEqualTo(6);
        assertThat(splits(processing)).isEmpty();
        assertThat(analysisStatus(pending)).isEqualTo("PENDING");
        assertThat(analysisStatus(ready)).isEqualTo("READY");
        assertThat(analysisStatus(legacy)).isEqualTo("LEGACY");
        assertThat(((Number) session(legacy).get("state_version")).longValue()).isZero();

        // 두 번째 실행은 바꿀 것이 없다.
        assertThat(analysisService.failInterruptedAnalyses()).isZero();
        assertThat(((Number) session(processing).get("state_version")).longValue()).isEqualTo(6);
    }

    // ---------- 종료 API 경로 ----------

    @Test
    void S06_종료_결과가_커밋되면_분석이_이어져_READY가_되고_S02에_반영된다() throws Exception {
        String ended = "2026-10-28T01:30:00Z";
        long sessionId = insertSession(userId, "RUNNING", 4, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = TIMESTAMPTZ '2026-10-28T01:00:00Z' WHERE id=?",
                sessionId);
        sample(sessionId, 0, "0", "140", "170");
        sample(sessionId, 300, "1000", "150", "170");
        sample(sessionId, 750, "2500", "160", "170");

        String approval =
                mockMvc.perform(
                                postControl(
                                        userId,
                                        sessionId,
                                        "finish",
                                        requestBody(watchId, 4)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long commandId = Long.parseLong(approval.replaceAll(".*\"commandId\":([0-9]+).*", "$1"));
        String body =
                resultBody(commandId, watchId, "APPLIED", ended)
                        .replace("}", ",\"uploadComplete\":true}");

        mockMvc.perform(postControl(userId, sessionId, "finish", body)).andExpect(status().isOk());
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(15))).isTrue();

        Map<String, Object> row = session(sessionId);
        assertThat(row.get("analysis_status")).isEqualTo("READY");
        // END 확정 5, 분석 READY 6
        assertThat(((Number) row.get("state_version")).longValue()).isEqualTo(6);
        assertThat(num(row, "total_distance")).isEqualByComparingTo("2500");
        assertThat(((Number) row.get("elapsed_duration")).intValue()).isEqualTo(1800);
        assertThat(splits(sessionId)).hasSize(3);
        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis.status").value("READY"))
                .andExpect(jsonPath("$.stateVersion").value(6));
    }
}
