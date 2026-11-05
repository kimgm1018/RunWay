package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.readiness.service.ReadinessEvaluationService;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 254 AC-9. 평가 실패가 W06 응답·저장을 깨지 않고, 한 날짜 실패가 다른 날짜 평가를 막지 않으며, 로그에 회원 ID·날짜·예외 종류만 남고 건강값·예외
 * 메시지는 남지 않는지 확인한다.
 */
@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
class ReadinessEvaluationFailureIntegrationTest extends ReadinessIntegrationSupport {

    /** 건강값이 들어간 것처럼 꾸민 예외 메시지. 로그에 나오면 안 된다. */
    private static final String SECRET_MESSAGE = "Failing row contains (66.43)";

    @Autowired private ReadinessEvaluationService evaluationService;

    @Test
    void 평가가_실패해도_W06은_200이고_건강값은_저장된다(CapturedOutput output) throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");
        doThrow(new DataIntegrityViolationException(SECRET_MESSAGE))
                .when(evaluationService)
                .evaluate(anyLong(), eq(date));

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66.43"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1));
        awaitEvaluations();

        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM daily_health_metrics WHERE user_id=? AND metric_date=?",
                                Integer.class,
                                userId,
                                date))
                .isEqualTo(1);
        assertThat(readinessRows(userId)).isEmpty();
        assertThat(output.getAll())
                .contains(
                        "준비도 자동 평가 실패 (userId="
                                + userId
                                + ", date="
                                + date
                                + ", DataIntegrityViolationException)")
                .doesNotContain(SECRET_MESSAGE)
                .doesNotContain("66.43");
    }

    @Test
    void 한_날짜가_실패해도_다른_날짜는_평가한다() throws Exception {
        LocalDate later = today();
        LocalDate earlier = today().minusDays(1);
        // later의 평소 RHR은 earlier(W06로 저장) + earlier 이전 6일로 7일이 된다.
        insertBaseline(userId, earlier, 7, "60");
        doThrow(new IllegalStateException(SECRET_MESSAGE))
                .when(evaluationService)
                .evaluate(anyLong(), eq(earlier));
        doCallRealMethod().when(evaluationService).evaluate(anyLong(), eq(later));

        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(estimate(earlier, 1, "66"), estimate(later, 1, "60"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        assertThat(readinessRows(userId))
                .singleElement()
                .satisfies(row -> assertThat(row.get("readiness_date").toString()).isEqualTo(later.toString()));
    }
}
