package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import com.runway.backend.infrastructure.ai.FakeAiServer;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * W07 새 batch 저장 → AI04 HTTP 호출 → 코칭 저장·발행 — 257 플랜 AC-9, 421 플랜 AC-1·AC-7·AC-8·AC-11(T-1·T-2·T-12·T-13·T-15).
 * AI 서버는 루프백 가짜 서버다. 모든 값은 합성 데이터다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class SyncBatchCoachingTriggerIntegrationTest extends SyncBatchIntegrationSupport {

    static final FakeAiServer AI = new FakeAiServer();

    @DynamicPropertySource
    static void aiProperties(DynamicPropertyRegistry registry) {
        registry.add("runway.coaching.ai.base-url", () -> AI.baseUri().toString());
    }

    @Autowired private SessionStreamRegistry streams;

    @BeforeEach
    void resetAi() {
        AI.reset();
        AI.respond(200, SyncBatchCoachingTriggerIntegrationTest::keepGuide);
    }

    /** 요청의 기준 페이스·BPM 160 유지, 발행 제안 없음. */
    static String keepGuide(String requestBody) {
        JsonNode context = JSON.readTree(requestBody).get("context");
        return """
                {"modelVersion":"m","policyVersion":"p","status":"OK","publishSuggested":false,
                 "decision":{"action":"GUIDE_PACE","chosenIndex":2,"recommendedPaceSecPerKm":%s,"cueBpm":160,
                             "basedOnStateVersion":%d,"expiresAt":"%s"},
                 "candidates":[],"warnings":[]}
                """.formatted(
                        context.get("anchorPaceSecPerKm").asString(),
                        context.get("stateVersion").longValue(),
                        Instant.now().plusSeconds(20));
    }

    /** 방금 측정한 심박·속도 표본. */
    private static ObjectNode live(int elapsedSec, int secondsAgo) {
        ObjectNode item = metric(elapsedSec, 150);
        item.put(
                "measuredAt",
                Instant.now().minusSeconds(secondsAgo).truncatedTo(ChronoUnit.MILLIS).toString());
        item.set("speedMps", JSON.valueToTree(new java.math.BigDecimal("2.500")));
        item.set("totalDistanceM", JSON.valueToTree(new java.math.BigDecimal(elapsedSec * 2.5 + "")));
        return item;
    }

    private long dueSession(boolean subscribe) {
        long sessionId = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '3 minutes' WHERE id=?",
                sessionId);
        if (subscribe) {
            // 폰의 S10 구독이 있어야 판단한다(257 리뷰 R-2).
            streams.subscribe(userId, sessionId, null);
        }
        return sessionId;
    }

    private int coachingCount(long sessionId) {
        return count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId);
    }

    private void await(java.util.function.BooleanSupplier condition) throws InterruptedException {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(10));
        while (!condition.getAsBoolean() && Instant.now().isBefore(deadline)) {
            Thread.sleep(50);
        }
    }

    /** 대기 중인 판단이 끝날 시간을 준다(발생하지 않아야 하는 호출 확인용). */
    private static void settle() throws InterruptedException {
        Thread.sleep(700);
    }

    @Test
    void 시작_2분_뒤_새_batch를_저장하면_AI04로_판단해_코칭을_발행한다() throws Exception {
        long sessionId = dueSession(true);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(178, 2), live(180, 0))))
                .andExpect(status().isOk());

        await(() -> coachingCount(sessionId) == 1);
        assertThat(coachingCount(sessionId)).isEqualTo(1);
        assertThat(AI.received()).hasSize(1);
        assertThat(AI.received().get(0).path()).isEqualTo("/v1/pace/decide");
        JsonNode request = JSON.readTree(AI.received().get(0).body());
        assertThat(request.get("context").get("sessionId").longValue()).isEqualTo(sessionId);
        assertThat(request.get("userId").longValue()).isEqualTo(userId);
        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events"
                                        + " WHERE session_id=? AND action='COACHING' AND result='PENDING'",
                                sessionId))
                .isEqualTo(1);
    }

    @Test
    void 같은_batch를_다시_보내면_AI를_다시_부르지_않는다() throws Exception {
        long sessionId = dueSession(true);
        String body = batch(newBatchId(), watchId, sessionId, live(180, 0));
        mockMvc.perform(syncRequest(userId, body)).andExpect(status().isOk());
        await(() -> coachingCount(sessionId) == 1);

        mockMvc.perform(syncRequest(userId, body)).andExpect(status().isOk());
        settle();

        assertThat(AI.received()).hasSize(1);
        assertThat(coachingCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 세션당_AI04는_15초_안에_한_번만_부른다() throws Exception {
        long sessionId = dueSession(true);
        // 2분 전 세션은 유지 판단을 저장하지 않으므로 명령이 다음 호출을 막지 않는다.
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '60 seconds' WHERE id=?",
                sessionId);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(55, 0))))
                .andExpect(status().isOk());
        await(() -> AI.received().size() == 1);
        settle();
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(60, 0))))
                .andExpect(status().isOk());
        settle();

        assertThat(AI.received()).hasSize(1);
        assertThat(coachingCount(sessionId)).isZero();
    }

    @Test
    void 폰의_S10_구독이_없으면_AI를_부르지_않는다() throws Exception {
        long sessionId = dueSession(false);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(180, 0))))
                .andExpect(status().isOk());
        settle();

        assertThat(AI.received()).isEmpty();
        assertThat(coachingCount(sessionId)).isZero();
    }

    @Test
    void AI가_실패하면_저장하지_않고_W07은_그대로_성공한다() throws Exception {
        AI.respond(503, "{\"code\":\"MODEL_NOT_READY\",\"message\":\"m\",\"details\":{}}");
        long sessionId = dueSession(true);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(180, 0))))
                .andExpect(status().isOk());
        await(() -> AI.received().size() == 1);
        settle();

        assertThat(AI.received()).hasSize(1);
        assertThat(coachingCount(sessionId)).isZero();
    }

    @Test
    void AI_응답이_늦어도_W07_응답은_기다리지_않는다() throws Exception {
        AI.delay(Duration.ofMillis(2500));
        long sessionId = dueSession(true);

        long started = System.nanoTime();
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(180, 0))))
                .andExpect(status().isOk());
        Duration w07 = Duration.ofNanos(System.nanoTime() - started);

        assertThat(w07).isLessThan(Duration.ofMillis(2000));
        await(() -> coachingCount(sessionId) == 1);
        assertThat(coachingCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 시작_2분_전에는_유지_판단을_발행하지_않는다() throws Exception {
        long sessionId = runningSession();
        streams.subscribe(userId, sessionId, null);

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, live(5, 0))))
                .andExpect(status().isOk());
        await(() -> AI.received().size() == 1);
        settle();

        assertThat(coachingCount(sessionId)).isZero();
    }
}
