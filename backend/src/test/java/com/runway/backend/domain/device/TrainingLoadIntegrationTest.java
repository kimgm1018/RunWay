package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadDispatcher;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadService;
import com.runway.backend.domain.session.service.PostRunAnalysisService;
import com.runway.backend.domain.session.service.RunningSessionDeletedEvent;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.node.ObjectNode;

/**
 * S15P31E105-599 AC-2·AC-3·AC-4. 러닝 종료 후 세션 부하 저장, W06 삼성 헬스 운동 요약(EXERCISE_HR_SUMMARY) 저장·검증, RunWay 러닝과
 * 겹치는 삼성 헬스 운동 제외, 러닝 삭제 시 부하 제거를 응답·DB 행·이벤트로 판정한다.
 *
 * <p>회원 나이는 30세(HRmax 190)로 맞추고 안정 심박은 넣지 않아 Zone은 HRmax 비율이다: Z1 95~114, Z2 114~133, Z3 133~152, Z4
 * 152~171, Z5 171~190(bpm). 150bpm 600초 = Z3 600초 = 부하 30. 모든 심박 값은 합성 데이터다.
 */
@Testcontainers
class TrainingLoadIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Autowired private TrainingLoadService trainingLoadService;
    @Autowired private TrainingLoadDispatcher trainingLoadDispatcher;
    @Autowired private PostRunAnalysisService analysisService;
    @Autowired private ApplicationEventPublisher publisher;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private com.runway.backend.domain.user.repository.WithdrawalRepository withdrawalRepository;

    @BeforeEach
    void ageThirty() {
        // 최근 59일 안의 어느 운동 날짜에서도 만 30세가 되도록 생일을 둔다.
        jdbc.update(
                "UPDATE users SET birth_date = ? WHERE id = ?",
                today().minusYears(30).minusDays(60),
                userId);
    }

    /** 종료 후 분석이 만든 구간은 세션 FK가 있어 베이스의 데이터 초기화(세션 삭제) 전에 지운다. */
    @org.junit.jupiter.api.AfterEach
    void cleanSplits() throws InterruptedException {
        awaitLoads();
        jdbc.update("DELETE FROM running_session_splits");
    }

    private void awaitLoads() throws InterruptedException {
        assertThat(trainingLoadDispatcher.awaitIdle(java.time.Duration.ofSeconds(15))).isTrue();
    }

    // ---------- 준비 ----------

    /** 오늘(UTC) 03:00Z = Asia/Seoul 12:00 같은 날짜. */
    private static Instant todayAt(int hourUtc) {
        return today().atTime(hourUtc, 0).toInstant(ZoneOffset.UTC);
    }

    private static ObjectNode exercise(
            String id, LocalDate date, Instant start, Instant end, int[]... buckets) {
        ObjectNode record = JSON.createObjectNode();
        record.put("type", "EXERCISE_HR_SUMMARY");
        record.put("exerciseId", id);
        record.put("metricDate", date.toString());
        record.put("startedAt", start.toString());
        record.put("endedAt", end.toString());
        var array = record.putArray("heartRateSeconds");
        for (int[] bucket : buckets) {
            ObjectNode node = array.addObject();
            node.put("bpm", bucket[0]);
            node.put("seconds", bucket[1]);
        }
        record.put("computedAt", end.toString());
        return record;
    }

    /** 오늘 03:00~03:10Z, 150bpm 600초 → 부하 30. */
    private static ObjectNode exerciseAt3(String id) {
        return exercise(id, today(), todayAt(3), todayAt(3).plusSeconds(600), new int[] {150, 600});
    }

    /** 종료된 러닝(시작 start, 길이 600초)과 5초 간격 심박 샘플. bpm이 null이면 심박 미측정 샘플이다. */
    private long finishedSession(Instant start, Integer bpm) {
        long sessionId = insertSession(userId, "COMPLETED", 5, watchId, phoneId);
        jdbc.update(
                "UPDATE running_sessions SET started_at = ?, ended_at = ?, analysis_status = 'PENDING'"
                        + " WHERE id = ?",
                java.sql.Timestamp.from(start),
                java.sql.Timestamp.from(start.plusSeconds(600)),
                sessionId);
        for (int sec = 0; sec <= 600; sec += 5) {
            jdbc.update(
                    "INSERT INTO running_metric_samples(running_session_id, device_id, measured_at,"
                            + " elapsed_duration, heart_rate, cadence, total_distance, route_progress,"
                            + " is_hr_measured)"
                            + " VALUES (?, ?, ?, ?, ?, 170, ?, 0, ?)",
                    sessionId,
                    watchId,
                    java.sql.Timestamp.from(start.plusSeconds(sec)),
                    sec,
                    bpm == null ? null : BigDecimal.valueOf(bpm),
                    BigDecimal.valueOf(sec * 3L),
                    bpm != null);
        }
        return sessionId;
    }

    private List<Map<String, Object>> loadRows() {
        return jdbc.queryForList(
                "SELECT source, running_session_id, external_id, metric_date, zone1_seconds, zone2_seconds,"
                        + " zone3_seconds, zone4_seconds, zone5_seconds, training_load"
                        + " FROM exercise_training_loads WHERE user_id = ? ORDER BY id",
                userId);
    }

    private BigDecimal dailyLoad(LocalDate date) {
        List<Map<String, Object>> rows = metricRows(userId, date);
        return rows.isEmpty() ? null : (BigDecimal) rows.get(0).get("daily_training_load");
    }

    private static DailyHealthMetricsChangedEvent loadEvent(long user, LocalDate date) {
        return new DailyHealthMetricsChangedEvent(user, List.of(date), List.of(date));
    }

    // ---------- W06 삼성 헬스 운동 요약 (AC-3) ----------

    @Test
    void 운동_요약을_저장하고_일별_부하와_부하_변경_날짜를_발행한다() throws Exception {
        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exercise(
                                                "uid-1:0",
                                                today(),
                                                todayAt(3),
                                                todayAt(3).plusSeconds(900),
                                                new int[] {100, 60},
                                                new int[] {150, 600},
                                                new int[] {160, 120},
                                                new int[] {185, 60}))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0))
                .andExpect(jsonPath("$.rejectedCount").value(0));

        // Z1 100bpm 60초, Z3 600초, Z4 120초, Z5 60초 → (60 + 1800 + 480 + 300) / 60 = 44
        assertThat(loadRows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row)
                                    .containsEntry("source", "SAMSUNG_HEALTH")
                                    .containsEntry("external_id", "uid-1:0")
                                    .containsEntry("running_session_id", null)
                                    .containsEntry("zone1_seconds", 60)
                                    .containsEntry("zone2_seconds", 0)
                                    .containsEntry("zone3_seconds", 600)
                                    .containsEntry("zone4_seconds", 120)
                                    .containsEntry("zone5_seconds", 60);
                            assertThat((BigDecimal) row.get("training_load"))
                                    .isEqualByComparingTo("44");
                        });
        assertThat(dailyLoad(today())).isEqualByComparingTo("44");
        assertThat(metricRows(userId, today()).get(0))
                .containsEntry("rhr_bpm", null)
                .containsEntry("sleep_duration_min", null);
        assertThat(events.committed).containsExactly(loadEvent(userId, today()));
    }

    @Test
    void 같은_내용을_다시_보내면_duplicate이고_바뀌면_갱신한다() throws Exception {
        mockMvc.perform(healthRequest(userId, sleepBody(exerciseAt3("uid-1:0"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        events.clear();

        mockMvc.perform(healthRequest(userId, sleepBody(exerciseAt3("uid-1:0"))))
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1));
        assertThat(events.committed).isEmpty();

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exercise(
                                                "uid-1:0",
                                                today(),
                                                todayAt(3),
                                                todayAt(3).plusSeconds(600),
                                                new int[] {150, 300}))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        assertThat(loadRows()).hasSize(1);
        assertThat(dailyLoad(today())).isEqualByComparingTo("15");
        assertThat(events.committed).containsExactly(loadEvent(userId, today()));
    }

    @Test
    void 날짜가_바뀌면_이전_날짜와_새_날짜를_모두_다시_계산한다() throws Exception {
        LocalDate yesterday = today().minusDays(1);
        mockMvc.perform(healthRequest(userId, sleepBody(exerciseAt3("uid-1:0"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        events.clear();

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exercise(
                                                "uid-1:0",
                                                yesterday,
                                                todayAt(3).minusSeconds(86_400),
                                                todayAt(3).minusSeconds(86_400 - 600),
                                                new int[] {150, 600}))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        assertThat(dailyLoad(today())).isNull();
        assertThat(dailyLoad(yesterday)).isEqualByComparingTo("30");
        assertThat(events.committed)
                .containsExactly(
                        new DailyHealthMetricsChangedEvent(
                                userId, List.of(yesterday, today()), List.of(yesterday, today())));
    }

    @Test
    void 같은_날짜의_운동은_더한다_수면과_한_요청에_섞을_수_있다() throws Exception {
        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exerciseAt3("uid-1:0"),
                                        sleep(today(), "420"),
                                        exercise(
                                                "uid-2:0",
                                                today(),
                                                todayAt(5),
                                                todayAt(5).plusSeconds(600),
                                                new int[] {160, 600}))))
                .andExpect(jsonPath("$.acceptedCount").value(3));

        // 30 + Z4 600초 40 = 70
        assertThat(dailyLoad(today())).isEqualByComparingTo("70");
        assertThat((BigDecimal) metricRows(userId, today()).get(0).get("sleep_duration_min"))
                .isEqualByComparingTo("420");
        assertThat(events.committed).containsExactly(loadEvent(userId, today()));
    }

    @Test
    void 동의가_없으면_403이고_저장하지_않는다() throws Exception {
        long noConsent = insertUser("DISAGREE");

        mockMvc.perform(healthRequest(noConsent, sleepBody(exerciseAt3("uid-1:0"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
        assertThat(count("SELECT count(*) FROM exercise_training_loads")).isZero();
    }

    static Stream<Arguments> invalidExercises() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        return Stream.of(
                Arguments.of("정의되지 않은 키", (Consumer<ObjectNode>) r -> r.put("extra", 1), null, "UNKNOWN_FIELD"),
                Arguments.of("필수 키 누락", (Consumer<ObjectNode>) r -> r.remove("endedAt"), "endedAt", "REQUIRED"),
                Arguments.of("ID 자료형", (Consumer<ObjectNode>) r -> r.put("exerciseId", 1), "exerciseId", "INVALID_TYPE"),
                Arguments.of("ID 문자", (Consumer<ObjectNode>) r -> r.put("exerciseId", "a b"), "exerciseId", "INVALID_FORMAT"),
                Arguments.of("ID 길이", (Consumer<ObjectNode>) r -> r.put("exerciseId", "a".repeat(129)), "exerciseId", "INVALID_FORMAT"),
                Arguments.of(
                        "날짜 30일 전",
                        (Consumer<ObjectNode>) r -> r.put("metricDate", today.minusDays(30).toString()),
                        "metricDate",
                        "OUT_OF_RANGE"),
                Arguments.of(
                        "시작 형식",
                        (Consumer<ObjectNode>) r -> r.put("startedAt", "2026-11-01T03:00:00+09:00"),
                        "startedAt",
                        "INVALID_FORMAT"),
                Arguments.of(
                        "종료가 시작보다 앞섬",
                        (Consumer<ObjectNode>) r -> r.put("endedAt", r.get("startedAt").stringValue().replace("T03", "T02")),
                        "endedAt",
                        "OUT_OF_RANGE"),
                Arguments.of(
                        "24시간 초과",
                        (Consumer<ObjectNode>)
                                r -> r.put("endedAt", Instant.parse(r.get("startedAt").stringValue()).plusSeconds(86_401).toString()),
                        "endedAt",
                        "OUT_OF_RANGE"),
                Arguments.of("구간이 배열 아님", (Consumer<ObjectNode>) r -> r.put("heartRateSeconds", 1), "heartRateSeconds", "INVALID_TYPE"),
                Arguments.of("빈 구간", (Consumer<ObjectNode>) r -> r.putArray("heartRateSeconds"), "heartRateSeconds", "OUT_OF_RANGE"),
                Arguments.of(
                        "bpm 중복",
                        (Consumer<ObjectNode>) r -> bucketsOf(r, new int[] {150, 10}, new int[] {150, 20}),
                        "heartRateSeconds",
                        "INVALID_FORMAT"),
                Arguments.of("bpm 범위", (Consumer<ObjectNode>) r -> bucketsOf(r, new int[] {29, 10}), "heartRateSeconds", "OUT_OF_RANGE"),
                Arguments.of("초 0", (Consumer<ObjectNode>) r -> bucketsOf(r, new int[] {150, 0}), "heartRateSeconds", "OUT_OF_RANGE"),
                Arguments.of(
                        "초 합이 길이 + 60 초과",
                        (Consumer<ObjectNode>) r -> bucketsOf(r, new int[] {150, 600}, new int[] {151, 61}),
                        "heartRateSeconds",
                        "OUT_OF_RANGE"),
                Arguments.of(
                        "구간 키",
                        (Consumer<ObjectNode>)
                                r -> ((ObjectNode) r.get("heartRateSeconds").get(0)).put("extra", 1),
                        "heartRateSeconds",
                        "INVALID_FORMAT"),
                Arguments.of(
                        "bpm 소수",
                        (Consumer<ObjectNode>)
                                r -> ((ObjectNode) r.get("heartRateSeconds").get(0)).put("bpm", 150.5),
                        "heartRateSeconds",
                        "INVALID_TYPE"),
                Arguments.of(
                        "computedAt 형식",
                        (Consumer<ObjectNode>) r -> r.put("computedAt", "x"),
                        "computedAt",
                        "INVALID_FORMAT"));
    }

    private static void bucketsOf(ObjectNode record, int[]... buckets) {
        var array = record.putArray("heartRateSeconds");
        for (int[] bucket : buckets) {
            ObjectNode node = array.addObject();
            node.put("bpm", bucket[0]);
            node.put("seconds", bucket[1]);
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidExercises")
    void 위반_레코드는_거절하고_저장하지_않는다(
            String name, Consumer<ObjectNode> breakIt, String field, String reason) throws Exception {
        ObjectNode record = exerciseAt3("uid-1:0");
        breakIt.accept(record);

        mockMvc.perform(healthRequest(userId, sleepBody(record, exerciseAt3("uid-2:0"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].index").value(0))
                .andExpect(jsonPath("$.errors[0].code").value("INVALID_RECORD"))
                .andExpect(jsonPath("$.errors[0].reason").value(reason))
                .andExpect(
                        field == null
                                ? jsonPath("$.errors[0].field", org.hamcrest.Matchers.nullValue())
                                : jsonPath("$.errors[0].field").value(field));
        assertThat(loadRows()).singleElement().satisfies(r -> assertThat(r).containsEntry("external_id", "uid-2:0"));
    }

    @Test
    void 날짜는_29일_전까지_받는다() throws Exception {
        LocalDate oldest = today().minusDays(29);
        Instant start = oldest.atTime(3, 0).toInstant(ZoneOffset.UTC);

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(exercise("uid-1:0", oldest, start, start.plusSeconds(600), new int[] {150, 600}))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        assertThat(dailyLoad(oldest)).isEqualByComparingTo("30");
    }

    @Test
    void 운동_요약은_RUNWAY_WATCH_provider에서_UNKNOWN_FIELD다() throws Exception {
        mockMvc.perform(healthRequest(userId, healthBody(exerciseAt3("uid-1:0"))))
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].reason").value("UNKNOWN_FIELD"));
        assertThat(loadRows()).isEmpty();
    }

    // ---------- 러닝 세션 부하 (AC-2) ----------

    @Test
    void 분석이_끝나면_세션_부하를_저장하고_일별_부하에_반영한다() throws InterruptedException {
        long sessionId = finishedSession(todayAt(3), 150);

        assertThat(analysisService.analyze(sessionId)).isEqualTo(PostRunAnalysisService.Outcome.READY);
        awaitLoads();

        assertThat(loadRows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row)
                                    .containsEntry("source", "RUNWAY_SESSION")
                                    .containsEntry("running_session_id", sessionId)
                                    .containsEntry("external_id", null)
                                    .containsEntry("metric_date", java.sql.Date.valueOf(today()))
                                    .containsEntry("zone3_seconds", 600);
                            assertThat((BigDecimal) row.get("training_load")).isEqualByComparingTo("30");
                        });
        assertThat(dailyLoad(today())).isEqualByComparingTo("30");
        assertThat(events.committed).containsExactly(loadEvent(userId, today()));
    }

    @Test
    void 같은_세션을_다시_계산해도_한_행이고_이벤트가_없다() {
        long sessionId = finishedSession(todayAt(3), 150);
        trainingLoadService.recordSession(sessionId);
        events.clear();

        trainingLoadService.recordSession(sessionId);

        assertThat(loadRows()).hasSize(1);
        assertThat(dailyLoad(today())).isEqualByComparingTo("30");
        assertThat(events.committed).isEmpty();
    }

    @Test
    void 러닝_날짜는_Asia_Seoul_기준이다() {
        // 전날 15:30Z = 오늘 00:30 KST
        long sessionId = finishedSession(todayAt(15).minusSeconds(86_400 - 1_800), 150);

        trainingLoadService.recordSession(sessionId);

        assertThat(dailyLoad(today())).isEqualByComparingTo("30");
        assertThat(dailyLoad(today().minusDays(1))).isNull();
    }

    @Test
    void 심박이_측정되지_않은_러닝은_부하_행을_만들지_않는다() {
        long sessionId = finishedSession(todayAt(3), null);

        trainingLoadService.recordSession(sessionId);

        assertThat(loadRows()).isEmpty();
        assertThat(metricRows(userId, today())).isEmpty();
        assertThat(events.committed).isEmpty();
    }

    @Test
    void 동의가_없으면_세션_부하를_저장하지_않는다() {
        long sessionId = finishedSession(todayAt(3), 150);
        jdbc.update("UPDATE users SET health_data_access = 'DISAGREE' WHERE id = ?", userId);

        trainingLoadService.recordSession(sessionId);

        assertThat(loadRows()).isEmpty();
        assertThat(metricRows(userId, today())).isEmpty();
    }

    @Test
    void 러닝을_삭제하면_부하를_지우고_일별_부하를_비운다() throws InterruptedException {
        long sessionId = finishedSession(todayAt(3), 150);
        trainingLoadService.recordSession(sessionId);
        events.clear();
        jdbc.update("UPDATE running_sessions SET deleted_at = now() WHERE id = ?", sessionId);

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(tx -> publisher.publishEvent(new RunningSessionDeletedEvent(sessionId)));
        awaitLoads();

        assertThat(loadRows()).isEmpty();
        assertThat(dailyLoad(today())).isNull();
        assertThat(events.committed).containsExactly(loadEvent(userId, today()));
    }

    /** 리뷰 A-1·B-1: 동의를 철회한 뒤 삭제한 러닝의 부하도 지운다(새로 계산·저장은 하지 않음). */
    @Test
    void 동의를_철회한_뒤_삭제한_러닝의_부하도_지운다() {
        long sessionId = finishedSession(todayAt(3), 150);
        trainingLoadService.recordSession(sessionId);
        jdbc.update("UPDATE users SET health_data_access = 'DISAGREE' WHERE id = ?", userId);
        jdbc.update("UPDATE running_sessions SET deleted_at = now() WHERE id = ?", sessionId);

        trainingLoadService.recordSession(sessionId);

        assertThat(loadRows()).isEmpty();
        assertThat(dailyLoad(today())).isNull();
    }

    /** 리뷰 A-2·B-2: 부하 잠금을 잡은 뒤 세션을 다시 읽으므로, 처리 시점에 이미 삭제된 러닝은 저장하지 않는다. */
    @Test
    void 처리_시점에_삭제된_러닝은_저장하지_않는다() {
        long sessionId = finishedSession(todayAt(3), 150);
        jdbc.update("UPDATE running_sessions SET deleted_at = now() WHERE id = ?", sessionId);

        trainingLoadService.recordSession(sessionId);

        assertThat(loadRows()).isEmpty();
        assertThat(metricRows(userId, today())).isEmpty();
    }

    /** 리뷰 A-7: 탈퇴 정리가 운동 부하를 지운다. */
    @Test
    void 탈퇴_정리는_운동_부하를_지운다() throws Exception {
        mockMvc.perform(healthRequest(userId, sleepBody(exerciseAt3("uid-1:0"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        trainingLoadService.recordSession(finishedSession(todayAt(5), 150));
        assertThat(loadRows()).hasSize(2);

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(tx -> withdrawalRepository.scrub(userId, Instant.now()));

        assertThat(loadRows()).isEmpty();
    }

    // ---------- 겹치는 운동 제외 (AC-4) ----------

    @Test
    void RunWay_러닝과_겹치는_삼성_운동은_세지_않는다_러닝이_먼저() throws Exception {
        trainingLoadService.recordSession(finishedSession(todayAt(3), 150));

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exercise(
                                                "uid-1:0",
                                                today(),
                                                todayAt(3).plusSeconds(60),
                                                todayAt(3).plusSeconds(660),
                                                new int[] {170, 600}),
                                        exercise(
                                                "uid-2:0",
                                                today(),
                                                todayAt(5),
                                                todayAt(5).plusSeconds(600),
                                                new int[] {150, 600}))))
                .andExpect(jsonPath("$.acceptedCount").value(2));

        // 러닝 30 + 겹치지 않는 삼성 30 = 60(겹치는 Z4 40은 제외)
        assertThat(dailyLoad(today())).isEqualByComparingTo("60");
        assertThat(loadRows()).hasSize(3);
    }

    @Test
    void RunWay_러닝과_겹치는_삼성_운동은_세지_않는다_삼성이_먼저() throws Exception {
        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exercise(
                                                "uid-1:0",
                                                today(),
                                                todayAt(3).plusSeconds(60),
                                                todayAt(3).plusSeconds(660),
                                                new int[] {170, 600}))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        assertThat(dailyLoad(today())).isEqualByComparingTo("40");

        long sessionId = finishedSession(todayAt(3), 150);
        trainingLoadService.recordSession(sessionId);
        assertThat(dailyLoad(today())).isEqualByComparingTo("30");

        // 러닝을 지우면 삼성 운동이 다시 세진다.
        jdbc.update("UPDATE running_sessions SET deleted_at = now() WHERE id = ?", sessionId);
        trainingLoadService.recordSession(sessionId);
        assertThat(dailyLoad(today())).isEqualByComparingTo("40");
    }

    @Test
    void 경계만_맞닿은_운동은_겹치지_않는다() throws Exception {
        trainingLoadService.recordSession(finishedSession(todayAt(3), 150));

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        exercise(
                                                "uid-1:0",
                                                today(),
                                                todayAt(3).plusSeconds(600),
                                                todayAt(3).plusSeconds(1200),
                                                new int[] {150, 600}))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        assertThat(dailyLoad(today())).isEqualByComparingTo("60");
    }
}
