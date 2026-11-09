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
 * S15P31E105-600 W06 삼성 헬스 심박 기반 안정 심박(provider SAMSUNG_HEALTH, type DAILY_RESTING_HR). 저장·출처·워치 우선 규칙·수면과
 * 혼합 요청·검증·동의를 응답과 DB 행·이벤트로 판정한다. 모든 심박 값은 합성 데이터다.
 */
@Testcontainers
class HealthRecordSyncRestingHrIntegrationTest extends HealthRecordSyncIntegrationSupport {

    private Map<String, Object> row(LocalDate date) {
        List<Map<String, Object>> rows = metricRows(userId, date);
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    @Test
    void 삼성_안정_심박을_출처와_함께_저장하고_변경_날짜를_발행한다() throws Exception {
        LocalDate date = today();

        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "57.3"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0))
                .andExpect(jsonPath("$.rejectedCount").value(0));

        Map<String, Object> row = row(date);
        assertThat((BigDecimal) row.get("rhr_bpm")).isEqualByComparingTo("57.30");
        assertThat(row)
                .containsEntry("rhr_source", "SAMSUNG_HEALTH")
                .containsEntry("rhr_revision", null)
                .containsEntry("sleep_duration_min", null);
        assertThat(events.committed)
                .containsExactly(new DailyHealthMetricsChangedEvent(userId, List.of(date)));
    }

    @Test
    void 삼성_값끼리는_같은_값이면_duplicate이고_다르면_마지막_값으로_갱신한다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "57.3"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        Object updatedAt = row(date).get("updated_at");
        events.clear();

        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "57.30"))))
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1));
        assertThat(row(date).get("updated_at")).isEqualTo(updatedAt);
        assertThat(events.committed).isEmpty();

        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "55.9"))))
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0));
        assertThat((BigDecimal) row(date).get("rhr_bpm")).isEqualByComparingTo("55.90");
        assertThat(row(date)).containsEntry("rhr_source", "SAMSUNG_HEALTH");
    }

    @Test
    void 워치_값이_있는_날짜의_삼성_값은_duplicate이고_워치_값을_유지한다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 2, "58.4"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        events.clear();

        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "52.0"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        Map<String, Object> row = row(date);
        assertThat((BigDecimal) row.get("rhr_bpm")).isEqualByComparingTo("58.40");
        assertThat(row).containsEntry("rhr_source", "RUNWAY_WATCH").containsEntry("rhr_revision", 2);
        assertThat(events.committed).isEmpty();
    }

    @Test
    void 삼성_값만_있던_날짜에_워치_값이_오면_revision과_관계없이_워치_값으로_바꾼다() throws Exception {
        LocalDate date = today().minusDays(1);
        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "52.0"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));
        events.clear();

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "58.4"))))
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0));

        Map<String, Object> row = row(date);
        assertThat((BigDecimal) row.get("rhr_bpm")).isEqualByComparingTo("58.40");
        assertThat(row).containsEntry("rhr_source", "RUNWAY_WATCH").containsEntry("rhr_revision", 1);
        assertThat(events.committed)
                .containsExactly(new DailyHealthMetricsChangedEvent(userId, List.of(date)));

        // 워치 값이 생긴 뒤의 삼성 값은 다시 바꾸지 않는다.
        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "51.0"))))
                .andExpect(jsonPath("$.duplicateCount").value(1));
        assertThat(row(date)).containsEntry("rhr_source", "RUNWAY_WATCH");
    }

    @Test
    void 워치_revision_규칙은_워치_값끼리만_적용된다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "58.4"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 2, "50.0"))))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        assertThat((BigDecimal) row(date).get("rhr_bpm")).isEqualByComparingTo("58.40");
    }

    @Test
    void 출처_없이_값만_있는_행은_삼성_값이_덮어쓰지_않는다() throws Exception {
        LocalDate date = today();
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm) VALUES (?,?,60)",
                userId,
                date);

        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "52.0"))))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        assertThat((BigDecimal) row(date).get("rhr_bpm")).isEqualByComparingTo("60");
        assertThat(row(date)).containsEntry("rhr_source", null);
    }

    @Test
    void 수면만_있는_행에_삼성_안정_심박을_더해도_수면은_그대로다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, sleepBody(sleep(date, "420"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        mockMvc.perform(healthRequest(userId, sleepBody(restingHr(date, "57.3"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        Map<String, Object> row = row(date);
        assertThat((BigDecimal) row.get("sleep_duration_min")).isEqualByComparingTo("420");
        assertThat((BigDecimal) row.get("rhr_bpm")).isEqualByComparingTo("57.30");
        assertThat(healthRows()).isEqualTo(1);
    }

    @Test
    void 한_요청에_수면과_안정_심박을_섞어_보낼_수_있다() throws Exception {
        LocalDate today = today();
        LocalDate yesterday = today.minusDays(1);

        mockMvc.perform(
                        healthRequest(
                                userId,
                                sleepBody(
                                        sleep(today, "410"),
                                        restingHr(today, "56.1"),
                                        restingHr(yesterday, "300"),
                                        sleep(yesterday, "380"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(3))
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].index").value(2))
                .andExpect(jsonPath("$.errors[0].field").value("restingHrBpm"))
                .andExpect(jsonPath("$.errors[0].reason").value("OUT_OF_RANGE"));

        assertThat((BigDecimal) row(today).get("rhr_bpm")).isEqualByComparingTo("56.10");
        assertThat((BigDecimal) row(today).get("sleep_duration_min")).isEqualByComparingTo("410");
        assertThat(row(yesterday)).containsEntry("rhr_bpm", null);
        assertThat((BigDecimal) row(yesterday).get("sleep_duration_min"))
                .isEqualByComparingTo("380");
        assertThat(events.committed)
                .containsExactly(
                        new DailyHealthMetricsChangedEvent(userId, List.of(yesterday, today)));
    }

    private static Arguments violation(
            String name, Consumer<ObjectNode> mutate, String code, String field, String reason) {
        return Arguments.of(name, mutate, code, field, reason);
    }

    static Stream<Arguments> restingHrViolations() {
        return Stream.of(
                violation("필드 누락", r -> r.remove("validMinuteCount"), "INVALID_RECORD", "validMinuteCount", "REQUIRED"),
                violation("워치 필드 혼입", r -> r.put("revision", 1), "INVALID_RECORD", null, "UNKNOWN_FIELD"),
                violation("수면 필드 혼입", r -> r.put("sleepDurationMin", 400), "INVALID_RECORD", null, "UNKNOWN_FIELD"),
                violation("metricDate 9일 전", r -> r.put("metricDate", today().minusDays(9).toString()), "INVALID_RECORD", "metricDate", "OUT_OF_RANGE"),
                violation("metricDate 형식", r -> r.put("metricDate", "2026/11/09"), "INVALID_RECORD", "metricDate", "INVALID_FORMAT"),
                violation("29.99bpm", r -> r.put("restingHrBpm", new BigDecimal("29.99")), "INVALID_RECORD", "restingHrBpm", "OUT_OF_RANGE"),
                violation("220.01bpm", r -> r.put("restingHrBpm", new BigDecimal("220.01")), "INVALID_RECORD", "restingHrBpm", "OUT_OF_RANGE"),
                violation("소수 3자리", r -> r.put("restingHrBpm", new BigDecimal("57.123")), "INVALID_RECORD", "restingHrBpm", "TOO_MANY_DECIMALS"),
                violation("bpm 문자열", r -> r.put("restingHrBpm", "57"), "INVALID_RECORD", "restingHrBpm", "INVALID_TYPE"),
                violation("워치 method", r -> r.put("method", "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2"), "UNSUPPORTED_RECORD_TYPE", "method", "UNSUPPORTED"),
                violation("유효 분 29", r -> r.put("validMinuteCount", 29), "INVALID_RECORD", "validMinuteCount", "OUT_OF_RANGE"),
                violation("유효 분 1441", r -> r.put("validMinuteCount", 1441), "INVALID_RECORD", "validMinuteCount", "OUT_OF_RANGE"),
                violation("유효 분 소수", r -> r.put("validMinuteCount", new BigDecimal("30.5")), "INVALID_RECORD", "validMinuteCount", "INVALID_TYPE"),
                violation("computedAt 오프셋", r -> r.put("computedAt", "2026-11-09T09:00:00+09:00"), "INVALID_RECORD", "computedAt", "INVALID_FORMAT"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("restingHrViolations")
    void 안정_심박_레코드_위반은_그_항목만_거절하고_저장하지_않는다(
            String name, Consumer<ObjectNode> mutate, String code, String field, String reason)
            throws Exception {
        ObjectNode record = restingHr(today(), "57.3");
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
    void 경계값_30bpm_220bpm_유효분_30_1440은_저장한다() throws Exception {
        ObjectNode low = restingHr(today(), "30");
        low.put("validMinuteCount", 30);
        ObjectNode high = restingHr(today().minusDays(1), "220.00");
        high.put("validMinuteCount", 1440);

        mockMvc.perform(healthRequest(userId, sleepBody(low, high)))
                .andExpect(jsonPath("$.acceptedCount").value(2));
    }

    @Test
    void 워치_provider로_보낸_안정_심박_레코드는_정의되지_않은_키로_거절한다() throws Exception {
        mockMvc.perform(healthRequest(userId, healthBody(restingHr(today(), "57.3"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors[0].code").value("INVALID_RECORD"))
                .andExpect(jsonPath("$.errors[0].reason").value("UNKNOWN_FIELD"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 건강정보_미동의_회원의_안정_심박은_403이고_저장하지_않는다() throws Exception {
        long disagree = insertUser("DISAGREE");

        mockMvc.perform(healthRequest(disagree, sleepBody(restingHr(today(), "57.3"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
        assertThat(healthRows()).isZero();
    }
}
