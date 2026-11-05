package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.coaching.decide.PaceDecider;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import com.runway.backend.infrastructure.ai.AiPaceDecideHttpClient;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.node.ObjectNode;

/**
 * AI 서버 주소가 없으면 기동은 하고 자동 코칭을 하지 않는다(더미로 대체하지 않음) — 421 플랜 AC-9(T-14). 다른 W07 통합 테스트와 같은
 * 컨텍스트(주소 미설정)를 쓴다. 모든 값은 합성 데이터다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class SyncBatchCoachingDisabledIntegrationTest extends SyncBatchIntegrationSupport {

    @Autowired private SessionStreamRegistry streams;
    @Autowired private PaceDecider decider;

    @Test
    void AI_주소가_없으면_새_batch를_저장해도_코칭을_만들지_않는다() throws Exception {
        assertThat(decider).isNotInstanceOf(AiPaceDecideHttpClient.class);
        long sessionId = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '3 minutes' WHERE id=?",
                sessionId);
        streams.subscribe(userId, sessionId, null);
        ObjectNode item = metric(180, 150);
        item.put("measuredAt", Instant.now().truncatedTo(ChronoUnit.MILLIS).toString());
        item.set("speedMps", JSON.valueToTree(new java.math.BigDecimal("2.500")));

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, item)))
                .andExpect(status().isOk());
        Thread.sleep(700);

        assertThat(count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId))
                .isZero();
        assertThat(count("SELECT count(*) FROM running_metric_samples WHERE running_session_id=?", sessionId))
                .isEqualTo(1);
    }
}
