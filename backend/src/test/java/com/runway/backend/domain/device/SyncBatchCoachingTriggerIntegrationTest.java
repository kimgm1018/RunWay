package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * W07 새 batch 저장 뒤 서버 코칭 발행 판단이 실행되는지 확인한다 — S15P31E105-257 작업 계획 AC-9. 재전송(이미 저장된 batch)은 판단을 다시 일으키지
 * 않아도 되며, 발행 조건 자체는 SessionCoachingIntegrationTest가 다룬다. 모든 값은 합성 데이터다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class SyncBatchCoachingTriggerIntegrationTest extends SyncBatchIntegrationSupport {

    @Autowired private SessionStreamRegistry streams;

    private int coachingCount(long sessionId) {
        return count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId);
    }

    private void awaitCoaching(long sessionId, int expected) throws InterruptedException {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(10));
        while (coachingCount(sessionId) != expected && Instant.now().isBefore(deadline)) {
            Thread.sleep(50);
        }
    }

    @Test
    void 시작_2분_뒤_새_batch를_저장하면_더미_코칭을_발행한다() throws Exception {
        long sessionId = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '3 minutes' WHERE id=?",
                sessionId);
        // 폰의 S10 구독이 있어야 발행한다(리뷰 R-2).
        streams.subscribe(userId, sessionId, null);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, metric(1, 150))))
                .andExpect(status().isOk());

        awaitCoaching(sessionId, 1);
        assertThat(coachingCount(sessionId)).isEqualTo(1);
        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events"
                                        + " WHERE session_id=? AND action='COACHING' AND result='PENDING'",
                                sessionId))
                .isEqualTo(1);
    }

    @Test
    void 폰의_S10_구독이_없으면_발행하지_않는다() throws Exception {
        long sessionId = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '3 minutes' WHERE id=?",
                sessionId);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, metric(1, 150))))
                .andExpect(status().isOk());

        Thread.sleep(500);
        assertThat(coachingCount(sessionId)).isZero();
    }

    @Test
    void 시작_2분_전에는_batch를_저장해도_발행하지_않는다() throws Exception {
        long sessionId = runningSession();
        streams.subscribe(userId, sessionId, null);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, metric(1, 150))))
                .andExpect(status().isOk());

        Thread.sleep(500);
        assertThat(coachingCount(sessionId)).isZero();
    }
}
