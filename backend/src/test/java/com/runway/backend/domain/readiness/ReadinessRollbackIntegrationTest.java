package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 254 AC-4. 이벤트가 발행된 뒤 W06 트랜잭션이 롤백되면 준비도를 평가하지 않는다.
 *
 * <p>커밋 직전(BEFORE_COMMIT) 단계 테스트 구독자가 예외를 던져 롤백시킨다. 이 단계는 모든 구독자의 커밋 후 등록이 끝난 뒤이므로 "발행·등록 후 롤백"을
 * 만든다. 발행 기록으로 이벤트가 실제로 나갔음을 함께 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Import(ReadinessRollbackIntegrationTest.FailBeforeCommit.class)
class ReadinessRollbackIntegrationTest extends ReadinessIntegrationSupport {

    @Autowired private FailBeforeCommit failBeforeCommit;

    @AfterEach
    void reset() {
        failBeforeCommit.enabled = false;
        failBeforeCommit.seen.clear();
    }

    @Test
    void 이벤트_발행후_W06이_롤백되면_평가하지_않는다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");
        failBeforeCommit.enabled = true;

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().is5xxServerError());
        awaitEvaluations();

        assertThat(failBeforeCommit.seen).hasSize(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM daily_health_metrics WHERE user_id=? AND metric_date=?",
                                Integer.class,
                                userId,
                                date))
                .isZero();
        assertThat(readinessCount()).isZero();
    }

    @Test
    void 같은_요청이_커밋되면_평가한다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "66"))))
                .andExpect(status().isOk());
        awaitEvaluations();

        assertThat(readinessRows(userId)).hasSize(1);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FailBeforeCommit {

        volatile boolean enabled;
        final List<DailyHealthMetricsChangedEvent> seen = new CopyOnWriteArrayList<>();

        @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
        void onBeforeCommit(DailyHealthMetricsChangedEvent event) {
            seen.add(event);
            if (enabled) {
                throw new IllegalStateException("synthetic before-commit failure");
            }
        }
    }
}
