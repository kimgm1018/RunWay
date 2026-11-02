package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** W06 AC-1·AC-3·AC-4·AC-7. 저장·revision 갱신·재전송·부분 거절을 응답과 DB 행으로 판정한다. */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class HealthRecordSyncIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Test
    void 유효한_추정값을_날짜별_한_행으로_저장한다() throws Exception {
        LocalDate date = today();

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "58.4"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0))
                .andExpect(jsonPath("$.rejectedCount").value(0))
                .andExpect(jsonPath("$.errors").isEmpty());

        List<Map<String, Object>> rows = metricRows(userId, date);
        assertThat(rows).hasSize(1);
        assertThat((BigDecimal) rows.get(0).get("rhr_bpm")).isEqualByComparingTo("58.40");
        assertThat(rows.get(0))
                .containsEntry("rhr_revision", 3)
                .containsEntry("sleep_duration_min", null)
                .containsEntry("daily_training_load", null)
                .containsEntry("max_heart_rate", null);
        assertThat(healthRows()).isEqualTo(1);
    }

    @Test
    void 저장된_revision보다_큰_값만_갱신하고_늦게_온_옛_revision은_무시한다() throws Exception {
        LocalDate date = today().minusDays(1);
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "58.4"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 4, "57.9"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(0));
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "58.4"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1));
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 2, "60.0"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        List<Map<String, Object>> rows = metricRows(userId, date);
        assertThat(rows).hasSize(1);
        assertThat((BigDecimal) rows.get(0).get("rhr_bpm")).isEqualByComparingTo("57.90");
        assertThat(rows.get(0)).containsEntry("rhr_revision", 4);
    }

    @Test
    void 같은_요청을_다시_보내면_duplicate이고_행과_수정시각이_바뀌지_않는다() throws Exception {
        LocalDate date = today();
        String body = healthBody(estimate(date, 3, "58.4"));
        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());
        Object updatedAt = metricRows(userId, date).get(0).get("updated_at");

        mockMvc.perform(healthRequest(userId, body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(0))
                .andExpect(jsonPath("$.duplicateCount").value(1))
                .andExpect(jsonPath("$.rejectedCount").value(0));

        assertThat(healthRows()).isEqualTo(1);
        assertThat(metricRows(userId, date).get(0).get("updated_at")).isEqualTo(updatedAt);
    }

    @Test
    void 같은_revision의_다른_값은_duplicate이고_저장값을_유지한다() throws Exception {
        LocalDate date = today();
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "58.4"))))
                .andExpect(status().isOk());

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 3, "61.0"))))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        assertThat((BigDecimal) metricRows(userId, date).get(0).get("rhr_bpm"))
                .isEqualByComparingTo("58.4");
    }

    @Test
    void 부분_거절하면_유효한_레코드만_저장하고_건수가_요청과_대응한다() throws Exception {
        LocalDate existing = today().minusDays(2);
        mockMvc.perform(healthRequest(userId, healthBody(estimate(existing, 5, "55.0"))))
                .andExpect(status().isOk());
        LocalDate fresh = today().minusDays(1);

        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(
                                        estimate(fresh, 1, "59.5"),
                                        estimate(today(), 1, "250"),
                                        estimate(existing, 5, "55.0"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(1))
                .andExpect(jsonPath("$.rejectedCount").value(1))
                .andExpect(jsonPath("$.errors.length()").value(1))
                .andExpect(jsonPath("$.errors[0].index").value(1))
                .andExpect(jsonPath("$.errors[0].code").value("INVALID_RECORD"))
                .andExpect(jsonPath("$.errors[0].field").value("estimatedRestingHrBpm"))
                .andExpect(jsonPath("$.errors[0].reason").value("OUT_OF_RANGE"));

        assertThat(metricRows(userId, fresh)).hasSize(1);
        assertThat(metricRows(userId, today())).isEmpty();
        assertThat(healthRows()).isEqualTo(2);
    }

    @Test
    void 한_요청의_같은_날짜는_순서대로_처리해_큰_revision이_남는다() throws Exception {
        LocalDate date = today();

        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(estimate(date, 2, "60.0"), estimate(date, 1, "62.0"))))
                .andExpect(jsonPath("$.acceptedCount").value(1))
                .andExpect(jsonPath("$.duplicateCount").value(1));

        assertThat(metricRows(userId, date).get(0)).containsEntry("rhr_revision", 2);
    }

    @Test
    void 한_요청의_같은_날짜가_오름차순이면_각각_accepted로_센다() throws Exception {
        LocalDate date = today();

        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(estimate(date, 1, "62.0"), estimate(date, 2, "60.0"))))
                .andExpect(jsonPath("$.acceptedCount").value(2))
                .andExpect(jsonPath("$.duplicateCount").value(0));

        assertThat(metricRows(userId, date).get(0)).containsEntry("rhr_revision", 2);
        assertThat(healthRows()).isEqualTo(1);
    }

    @Test
    void 날짜_순서와_무관하게_거절_index는_요청_위치다() throws Exception {
        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(
                                        estimate(today(), 1, "58.4"),
                                        estimate(today().minusDays(1), 0, "58.4"),
                                        estimate(today().minusDays(2), 1, "58.4"),
                                        estimate(today().minusDays(3), 1, "10"))))
                .andExpect(jsonPath("$.acceptedCount").value(2))
                .andExpect(jsonPath("$.rejectedCount").value(2))
                .andExpect(jsonPath("$.errors[0].index").value(1))
                .andExpect(jsonPath("$.errors[0].field").value("revision"))
                .andExpect(jsonPath("$.errors[1].index").value(3))
                .andExpect(jsonPath("$.errors[1].field").value("estimatedRestingHrBpm"));
    }

    @Test
    void 다른_건강_컬럼이_있는_행은_심박_값만_갱신한다() throws Exception {
        LocalDate date = today();
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,sleep_duration_min) VALUES (?,?,420)",
                userId,
                date);

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "58.4"))))
                .andExpect(jsonPath("$.acceptedCount").value(1));

        Map<String, Object> row = metricRows(userId, date).get(0);
        assertThat((BigDecimal) row.get("sleep_duration_min")).isEqualByComparingTo("420");
        assertThat(row).containsEntry("rhr_revision", 1);
    }
}
