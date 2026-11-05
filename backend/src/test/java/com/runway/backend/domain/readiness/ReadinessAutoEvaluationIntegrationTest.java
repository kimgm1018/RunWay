package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.readiness.service.ReadinessEvaluationService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 254 AC-3·AC-4·AC-7. W06 저장 후 별도 평가 요청 없이 해당 날짜 준비도가 저장·갱신되는지 DB 행으로 확인한다.
 *
 * <p>현재 W06은 RHR만 저장하므로 결과는 회복 항목 하나로 계산되어 신뢰도 LOW다. 평소 RHR 60, 오늘 66(+10%) → 65점, 오늘 60(0%) → 100점.
 */
@Testcontainers
class ReadinessAutoEvaluationIntegrationTest extends ReadinessIntegrationSupport {

    @Autowired private ReadinessEvaluationService evaluationService;

    @Test
    void W06_저장후_해당날짜_준비도가_자동_저장된다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().get("readiness_date").toString()).isEqualTo(date.toString());
        assertThat((BigDecimal) rows.getFirst().get("readiness_score")).isEqualByComparingTo("65.00");
        assertThat(rows.getFirst().get("confidence")).isEqualTo("LOW");
        assertThat(readinessRows(otherUserId)).isEmpty();
    }

    @Test
    void 더_큰_revision으로_갱신하면_같은_행의_점수가_바뀐다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().isOk());
        awaitEvaluations();
        Object firstId = readinessRows(userId).getFirst().get("id");

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 2, "60"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().get("id")).isEqualTo(firstId);
        assertThat((BigDecimal) rows.getFirst().get("readiness_score")).isEqualByComparingTo("100.00");
    }

    @Test
    void 같은_요청_재전송은_duplicate라_다시_평가하지_않는다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");
        String body = healthBody(estimate(date, 1, "66"));
        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());
        awaitEvaluations();
        awaitEvaluations();
        // 재평가가 일어나면 65.00으로 돌아온다. 표식 값으로 바꿔 두고 재전송 후에도 남는지 본다.
        jdbc.update("UPDATE daily_readiness SET readiness_score = 1 WHERE user_id = ?", userId);

        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());
        awaitEvaluations();
        awaitEvaluations();

        assertThat((BigDecimal) readinessRows(userId).getFirst().get("readiness_score"))
                .isEqualByComparingTo("1");
    }

    @Test
    void 한_요청의_여러_날짜를_각각_평가한다() throws Exception {
        LocalDate later = today();
        LocalDate earlier = today().minusDays(1);
        insertBaseline(userId, earlier, 7, "60");

        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(estimate(later, 1, "60"), estimate(earlier, 1, "66"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows).hasSize(2);
        // earlier: 평소 60, 오늘 66 → 65. later: 평소(earlier 66 + 60×6)/7 = 60.857, 오늘 60 → 음수 → 100.
        assertThat((BigDecimal) rows.get(0).get("readiness_score")).isEqualByComparingTo("65.00");
        assertThat((BigDecimal) rows.get(1).get("readiness_score")).isEqualByComparingTo("100.00");
    }

    @Test
    void 계산할_항목이_없으면_저장하지_않는다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 2, "60"); // 평소 RHR 3일 미만

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        assertThat(readinessRows(userId)).isEmpty();
    }

    @Test
    void 동의가_없는_회원은_평가하지_않는다() {
        LocalDate date = today();
        long disagreed = insertUser("DISAGREE");
        insertRestingHr(disagreed, date, "66");
        insertBaseline(disagreed, date, 7, "60");

        assertThat(evaluationService.evaluate(disagreed, date)).isEmpty();
        assertThat(readinessRows(disagreed)).isEmpty();
    }

    @Test
    void 탈퇴한_회원은_평가하지_않는다() {
        LocalDate date = today();
        insertRestingHr(userId, date, "66");
        insertBaseline(userId, date, 7, "60");
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);

        assertThat(evaluationService.evaluate(userId, date)).isEmpty();
        assertThat(readinessRows(userId)).isEmpty();
    }

    @Test
    void 동의가_철회되면_기존_결과는_두고_새로_평가하지_않는다() {
        LocalDate date = today();
        insertRestingHr(userId, date, "66");
        insertBaseline(userId, date, 7, "60");
        insertReadiness(userId, date, "1", "LOW");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        assertThat(evaluationService.evaluate(userId, date)).isEmpty();
        assertThat((BigDecimal) readinessRows(userId).getFirst().get("readiness_score"))
                .isEqualByComparingTo("1");
    }

    @Test
    void 동의가_없어_W06이_403이면_평가하지_않는다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().isForbidden());
        awaitEvaluations();

        assertThat(readinessCount()).isZero();
    }

    @Test
    void 오늘_값이_먼저_오고_이전_날짜가_나중에_와도_오늘을_다시_평가한다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 2, "60"); // D-1·D-2만 있음 → 평소 RHR 3일 미만
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().isOk());
        awaitEvaluations();
        assertThat(readinessRows(userId)).isEmpty();

        // D-3이 늦게 도착하면 D의 평소 RHR이 3일이 되어 D를 다시 평가한다(D-3 자신은 평소 값이 없어 결과 없음).
        mockMvc.perform(healthRequest(userId, healthBody(estimate(date.minusDays(3), 1, "60"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().get("readiness_date").toString()).isEqualTo(date.toString());
        assertThat((BigDecimal) rows.getFirst().get("readiness_score")).isEqualByComparingTo("65.00");
    }

    @Test
    void 바뀐_날짜의_이후_7일만_다시_평가하고_8일째는_두지_않는다() throws Exception {
        LocalDate changed = today().minusDays(8);
        // D-7~D-1과 D+1~D+8에 RHR을 넣는다. D+8도 평소 RHR이 갖춰져 평가하면 결과가 나오는 상태다. 결과는 아직 없다.
        insertBaseline(userId, changed, 7, "60");
        for (int i = 1; i <= 8; i++) {
            insertRestingHr(userId, changed.plusDays(i), "60");
        }

        mockMvc.perform(healthRequest(userId, healthBody(estimate(changed, 1, "60"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        List<String> dates =
                readinessRows(userId).stream().map(row -> row.get("readiness_date").toString()).toList();
        assertThat(dates).contains(changed.toString(), changed.plusDays(7).toString());
        assertThat(dates).doesNotContain(changed.plusDays(8).toString());
    }
}
