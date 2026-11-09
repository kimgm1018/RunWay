package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.node.ObjectNode;

/**
 * S15P31E105-572 W06 삼성 헬스 수면(provider SAMSUNG_HEALTH, type DAILY_SLEEP_SUMMARY). 저장·같은 값 재전송·값 변경·검증·동의를
 * 응답과 DB 행·이벤트로 판정한다. 모든 수면 값은 합성 데이터다.
 */
@Testcontainers
class HealthRecordSyncSleepIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Test
    void 수면을_기상일_행의_sleep_duration_min에_저장하고_변경_날짜를_발행한다() throws Exception {
        LocalDate date = today().minusDays(1);

        mockMvc.perform(healthRequest(userId, sleepBody(sleep(date, "412.5"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0))
                .andExpect(jsonPath("$.rejectedCount").value(0));

        List<Map<String, Object>> rows = metricRows(userId, date);
        assertThat(rows).hasSize(1);
        assertThat((BigDecimal) rows.get(0).get("sleep_duration_min"))
                .isEqualByComparingTo("412.50");
        assertThat(rows.get(0)).containsEntry("rhr_bpm", null).containsEntry("rhr_revision", null);
        assertThat(events.committed)
                .containsExactly(new DailyHealthMetricsChangedEvent(userId, List.of(date)));
    }

    @Test
    void 같은_값_재전송은_duplicate이고_행_수정시각_이벤트가_바뀌지_않는다() throws Exception {
        LocalDate date = today();
        String body = sleepBody(sleep(date, "420"));
        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());
        Object updatedAt = metricRows(userId, date).get(0).get("updated_at");
        events.clear();

        mockMvc.perform(healthRequest(userId, sleepBody(sleep(date, "420.00"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        assertThat(healthRows()).isEqualTo(1);
        assertThat(metricRows(userId, date).get(0).get("updated_at")).isEqualTo(updatedAt);
        assertThat(events.committed).isEmpty();
    }

    @Test
    void 값이_바뀌면_마지막_값으로_갱신한다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, sleepBody(sleep(date, "420"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        mockMvc.perform(healthRequest(userId, sleepBody(sleep(date, "395.25"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0));

        assertThat((BigDecimal) metricRows(userId, date).get(0).get("sleep_duration_min"))
                .isEqualByComparingTo("395.25");
    }

    @Test
    void 심박이_저장된_날짜에_수면을_더해도_심박은_그대로이고_반대도_같다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "58.4"))))
                .andExpect(status().isOk());

        mockMvc.perform(healthRequest(userId, sleepBody(sleep(date, "430"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 4, "57.0"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        Map<String, Object> row = metricRows(userId, date).get(0);
        assertThat((BigDecimal) row.get("rhr_bpm")).isEqualByComparingTo("57.00");
        assertThat(row).containsEntry("rhr_revision", 4);
        assertThat((BigDecimal) row.get("sleep_duration_min")).isEqualByComparingTo("430");
        assertThat(healthRows()).isEqualTo(1);
    }

    @Test
    void 여러_날짜_중_거절된_항목만_빼고_저장한다() throws Exception {
        LocalDate today = today();

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        sleep(today, "400"),
                                        sleep(today.minusDays(1), "0"),
                                        sleep(today.minusDays(2), "380"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(2))
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].index").value(1))
                .andExpect(jsonPath("$.errors[0].field").value("sleepDurationMin"))
                .andExpect(jsonPath("$.errors[0].reason").value("OUT_OF_RANGE"));

        assertThat(metricRows(userId, today.minusDays(1))).isEmpty();
        assertThat(events.committed)
                .containsExactly(
                        new DailyHealthMetricsChangedEvent(
                                userId, List.of(today.minusDays(2), today)));
    }

    private static Arguments violation(
            String name, Consumer<ObjectNode> mutate, String code, String field, String reason) {
        return Arguments.of(name, mutate, code, field, reason);
    }

    static Stream<Arguments> sleepViolations() {
        return Stream.of(
                violation("심박 type", r -> r.put("type", "DAILY_HR_ESTIMATE"), "UNSUPPORTED_RECORD_TYPE", "type", "UNSUPPORTED"),
                violation("type null", r -> r.putNull("type"), "UNSUPPORTED_RECORD_TYPE", "type", "UNSUPPORTED"),
                violation("필드 누락", r -> r.remove("computedAt"), "INVALID_RECORD", "computedAt", "REQUIRED"),
                violation("심박 필드 혼입", r -> r.put("revision", 1), "INVALID_RECORD", null, "UNKNOWN_FIELD"),
                violation("출처 필드 추가", r -> r.put("source", "watch"), "INVALID_RECORD", null, "UNKNOWN_FIELD"),
                violation("metricDate 9일 전", r -> r.put("metricDate", today().minusDays(9).toString()), "INVALID_RECORD", "metricDate", "OUT_OF_RANGE"),
                violation("metricDate 2일 뒤", r -> r.put("metricDate", today().plusDays(2).toString()), "INVALID_RECORD", "metricDate", "OUT_OF_RANGE"),
                violation("0분", r -> r.put("sleepDurationMin", 0), "INVALID_RECORD", "sleepDurationMin", "OUT_OF_RANGE"),
                violation("음수", r -> r.put("sleepDurationMin", new BigDecimal("-1")), "INVALID_RECORD", "sleepDurationMin", "OUT_OF_RANGE"),
                violation("1440.01분", r -> r.put("sleepDurationMin", new BigDecimal("1440.01")), "INVALID_RECORD", "sleepDurationMin", "OUT_OF_RANGE"),
                violation("소수 3자리", r -> r.put("sleepDurationMin", new BigDecimal("400.125")), "INVALID_RECORD", "sleepDurationMin", "TOO_MANY_DECIMALS"),
                violation("문자열", r -> r.put("sleepDurationMin", "400"), "INVALID_RECORD", "sleepDurationMin", "INVALID_TYPE"),
                violation("null", r -> r.putNull("sleepDurationMin"), "INVALID_RECORD", "sleepDurationMin", "INVALID_TYPE"),
                violation("computedAt 오프셋", r -> r.put("computedAt", "2026-10-30T09:00:00+09:00"), "INVALID_RECORD", "computedAt", "INVALID_FORMAT"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("sleepViolations")
    void 수면_레코드_위반은_그_항목만_거절하고_저장하지_않는다(
            String name, Consumer<ObjectNode> mutate, String code, String field, String reason)
            throws Exception {
        ObjectNode record = sleep(today(), "400");
        mutate.accept(record);

        mockMvc.perform(healthRequest(userId, sleepBody(record)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].index").value(0))
                .andExpect(jsonPath("$.errors[0].code").value(code))
                .andExpect(jsonPath("$.errors[0].field").value(field))
                .andExpect(jsonPath("$.errors[0].reason").value(reason));

        assertThat(healthRows()).isZero();
        assertThat(events.committed).isEmpty();
    }

    @Test
    void 경계값_1440분은_저장한다() throws Exception {
        mockMvc.perform(healthRequest(userId, sleepBody(sleep(today(), "1440"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
    }

    @Test
    void 워치_provider로_보낸_수면_레코드는_정의되지_않은_키로_거절한다() throws Exception {
        mockMvc.perform(healthRequest(userId, healthBody(sleep(today(), "400"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].code").value("INVALID_RECORD"))
                .andExpect(jsonPath("$.errors[0].reason").value("UNKNOWN_FIELD"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 건강정보_미동의_회원의_수면은_403이고_저장하지_않는다() throws Exception {
        long disagree = insertUser("DISAGREE");

        mockMvc.perform(healthRequest(disagree, sleepBody(sleep(today(), "400"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 탈퇴한_회원의_수면은_401() throws Exception {
        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE id=?", userId);

        mockMvc.perform(healthRequest(userId, sleepBody(sleep(today(), "400"))))
                .andExpect(status().isUnauthorized());
        assertThat(healthRows()).isZero();
    }
}
