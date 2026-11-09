package com.runway.backend.infrastructure.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.coaching.decide.CoachingLevel;
import com.runway.backend.domain.coaching.decide.PaceDecideRequest;
import com.runway.backend.domain.coaching.decide.PaceDecision;
import java.math.BigDecimal;
import java.net.ServerSocket;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** AI04 HTTP 어댑터 — 421 플랜 AC-2·AC-7(T-11). 가짜 서버는 루프백 전용이다. 모든 값은 합성 데이터다. */
class AiPaceDecideHttpClientTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final FakeAiServer server = new FakeAiServer();

    @AfterEach
    void close() {
        server.close();
    }

    private AiPaceDecideHttpClient client(Duration requestTimeout) {
        return new AiPaceDecideHttpClient(
                server.baseUri(), Duration.ofSeconds(1), requestTimeout, JSON);
    }

    static PaceDecideRequest request() {
        List<Double> speeds = Collections.nCopies(24, 2.5);
        List<PaceDecideRequest.Candidate> candidates =
                List.of(-10, -5, 0, 5, 10).stream()
                        .map(d -> new PaceDecideRequest.Candidate(
                                new BigDecimal("400.00").add(BigDecimal.valueOf(d)), speeds, null))
                        .toList();
        return new PaceDecideRequest(
                300,
                Instant.parse("2026-11-05T02:55:00Z"),
                null,
                new PaceDecideRequest.History(
                        java.util.Arrays.asList(null, 150.0),
                        java.util.Arrays.asList(2.5, 2.5),
                        java.util.Arrays.asList(null, null)),
                candidates,
                new PaceDecideRequest.Context(
                        9, 4, "RUNNING", "FREE_NO_GOAL",
                        new PaceDecideRequest.Goal(null, null, null),
                        new BigDecimal("0.5"), null,
                        new BigDecimal("400.00"), new BigDecimal("400.00"),
                        300, 750.0, null, Instant.parse("2026-11-05T03:00:00Z"), null, null, null),
                false);
    }

    static String okBody(String decision) {
        return """
                {"traceId":null,"modelVersion":"m","policyVersion":"p","status":"OK","gate":null,
                 "publishSuggested":true,"decision":%s,"candidates":[],"warnings":["X"]}
                """.formatted(decision);
    }

    static final String DECISION =
            """
            {"action":"GUIDE_PACE","chosenIndex":1,"recommendedPaceSecPerKm":395.004,"cueBpm":166,
             "predictedHr30Bpm":151.234,"predictedHr60Bpm":153,"predictedHr120Bpm":null,"routeProgressM":null,
             "basedOnStateVersion":4,"expiresAt":"2026-11-05T03:00:20+00:00","reason":"r","reasonText":"t"}
            """;

    @Test
    void 계약_형식의_요청을_보내고_응답을_판단으로_바꾼다() throws Exception {
        server.respond(200, okBody(DECISION));

        Optional<PaceDecision> decision = client(Duration.ofSeconds(3)).decide(request());

        assertThat(server.received()).hasSize(1);
        var received = server.received().get(0);
        assertThat(received.method()).isEqualTo("POST");
        assertThat(received.path()).isEqualTo("/v1/pace/decide");
        assertThat(received.contentType()).isEqualTo("application/json");
        JsonNode body = JSON.readTree(received.body());
        assertThat(body.get("elapsedSec").intValue()).isEqualTo(300);
        assertThat(body.get("userId").isNull()).isTrue();
        assertThat(body.get("history").get("hrBpm").get(0).isNull()).isTrue();
        assertThat(body.get("candidates")).hasSize(5);
        assertThat(body.get("candidates").get(0).get("paceSecPerKm").doubleValue()).isEqualTo(390.0);
        assertThat(body.get("candidates").get(0).get("futureGradePct").isNull()).isTrue();
        JsonNode context = body.get("context");
        assertThat(context.get("goal").has("targetDistanceM")).isTrue();
        assertThat(context.get("goal").get("targetDistanceM").isNull()).isTrue();
        assertThat(context.get("goalPreference").doubleValue()).isEqualTo(0.5);
        assertThat(context.get("inputAsOf").stringValue()).isEqualTo("2026-11-05T03:00:00Z");
        assertThat(context.has("bpm")).isFalse();
        assertThat(context.has("hrReference")).isFalse();
        assertThat(body.get("includeForecast").booleanValue()).isFalse();

        assertThat(decision).get().satisfies(d -> {
            assertThat(d.publishSuggested()).isTrue();
            assertThat(d.action()).isEqualTo(PaceDecision.Action.GUIDE_PACE);
            assertThat(d.recommendedPaceSecPerKm()).isEqualByComparingTo("395.00");
            assertThat(d.cueBpm()).isEqualTo(166);
            assertThat(d.predictedHr30Bpm()).isEqualByComparingTo("151.23");
            assertThat(d.predictedHr60Bpm()).isEqualByComparingTo("153.00");
            assertThat(d.predictedHr120Bpm()).isNull();
            assertThat(d.basedOnStateVersion()).isEqualTo(4);
            assertThat(d.expiresAt()).isEqualTo(Instant.parse("2026-11-05T03:00:20Z"));
            assertThat(d.coachingLevel()).isNull();
        });
    }

    @Test
    void coachingLevel이_있으면_단계로_파싱한다() {
        String decision =
                """
                {"action":"GUIDE_PACE","chosenIndex":1,"recommendedPaceSecPerKm":360,"cueBpm":165,
                 "predictedHr30Bpm":null,"predictedHr60Bpm":null,"predictedHr120Bpm":null,"routeProgressM":null,
                 "basedOnStateVersion":4,"expiresAt":"2026-11-05T03:00:20Z","reason":"r","reasonText":"t",
                 "coachingLevel":"CAUTION"}
                """;
        server.respond(200, okBody(decision));

        assertThat(client(Duration.ofSeconds(3)).decide(request()))
                .get()
                .extracting(PaceDecision::coachingLevel)
                .isEqualTo(CoachingLevel.CAUTION);
    }

    @Test
    void 잘못된_coachingLevel은_판단을_버린다() {
        String decision =
                """
                {"action":"GUIDE_PACE","chosenIndex":1,"recommendedPaceSecPerKm":360,"cueBpm":165,
                 "predictedHr30Bpm":null,"predictedHr60Bpm":null,"predictedHr120Bpm":null,"routeProgressM":null,
                 "basedOnStateVersion":4,"expiresAt":"2026-11-05T03:00:20Z","reason":"r","reasonText":"t",
                 "coachingLevel":"FAST"}
                """;
        server.respond(200, okBody(decision));

        assertThat(client(Duration.ofSeconds(3)).decide(request())).isEmpty();
    }

    @Test
    void decision이_null이면_판단_없음이다() {
        server.respond(200, okBody("null"));

        assertThat(client(Duration.ofSeconds(3)).decide(request())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 409, 422, 500, 503})
    void 오류_응답은_재시도_없이_빈_값이다(int status) {
        server.respond(status, "{\"code\":\"INPUT_INSUFFICIENT\",\"message\":\"m\",\"details\":{}}");

        assertThat(client(Duration.ofSeconds(3)).decide(request())).isEmpty();
        assertThat(server.received()).hasSize(1);
    }

    @Test
    void 시간_초과는_재시도_없이_빈_값이다() {
        server.respond(200, okBody(DECISION)).delay(Duration.ofMillis(1500));

        long started = System.nanoTime();
        assertThat(client(Duration.ofMillis(500)).decide(request())).isEmpty();
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(1400));
        assertThat(server.received()).hasSize(1);
    }

    @Test
    void 헤더_뒤_본문이_멈춰도_전체_기한에_끊는다() {
        server.respond(200, okBody(DECISION)).stallBody(Duration.ofSeconds(3));

        long started = System.nanoTime();
        assertThat(client(Duration.ofMillis(500)).decide(request())).isEmpty();
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(1500));
    }

    @Test
    void 본문이_상한을_넘으면_유효한_판단이어도_빈_값이다() {
        // 상한이 없다면 정상 판단으로 해석될 본문이다(재검토 R-2).
        String huge = okBody(DECISION).replace("\"warnings\":[\"X\"]",
                "\"warnings\":[\"" + "X".repeat(AiPaceDecideHttpClient.MAX_RESPONSE_BYTES) + "\"]");
        server.respond(200, huge);
        assertThat(client(Duration.ofSeconds(3)).decide(request())).isEmpty();

        // 길이를 알리지 않는(chunked) 응답도 받은 크기로 끊는다.
        server.stallBody(Duration.ofMillis(1));
        assertThat(client(Duration.ofSeconds(3)).decide(request())).isEmpty();

        // 같은 판단이 상한 안이면 받는다.
        server.reset();
        server.respond(200, okBody(DECISION));
        assertThat(client(Duration.ofSeconds(3)).decide(request())).isPresent();
    }

    @Test
    void 연결_거부는_빈_값이다() throws Exception {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        var closed = new AiPaceDecideHttpClient(
                URI.create("http://127.0.0.1:" + port), Duration.ofSeconds(1), Duration.ofSeconds(3), JSON);

        assertThat(closed.decide(request())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "not json",
        "[]",
        "{\"decision\":null}",
        "{\"publishSuggested\":\"yes\",\"decision\":null}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"RUN_FASTER\",\"recommendedPaceSecPerKm\":300,\"basedOnStateVersion\":1,\"expiresAt\":\"2026-11-05T03:00:20Z\"}}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"GUIDE_PACE\",\"recommendedPaceSecPerKm\":0,\"basedOnStateVersion\":1,\"expiresAt\":\"2026-11-05T03:00:20Z\"}}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"GUIDE_PACE\",\"recommendedPaceSecPerKm\":300,\"cueBpm\":221,\"basedOnStateVersion\":1,\"expiresAt\":\"2026-11-05T03:00:20Z\"}}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"GUIDE_PACE\",\"recommendedPaceSecPerKm\":300,\"cueBpm\":165.5,\"basedOnStateVersion\":1,\"expiresAt\":\"2026-11-05T03:00:20Z\"}}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"GUIDE_PACE\",\"recommendedPaceSecPerKm\":300,\"predictedHr30Bpm\":-1,\"basedOnStateVersion\":1,\"expiresAt\":\"2026-11-05T03:00:20Z\"}}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"GUIDE_PACE\",\"recommendedPaceSecPerKm\":300,\"basedOnStateVersion\":\"1\",\"expiresAt\":\"2026-11-05T03:00:20Z\"}}",
        "{\"publishSuggested\":true,\"decision\":{\"action\":\"GUIDE_PACE\",\"recommendedPaceSecPerKm\":300,\"basedOnStateVersion\":1,\"expiresAt\":\"2026-11-05T03:00:20\"}}"
    })
    void 계약과_다른_응답은_빈_값이다(String body) {
        server.respond(200, body);

        assertThat(client(Duration.ofSeconds(3)).decide(request())).isEmpty();
    }

    @Test
    void 주소_설정은_origin만_받고_비면_미설정이다() {
        assertThat(AiServiceConfig.parseBaseUrl(" ")).isNull();
        assertThat(AiServiceConfig.parseBaseUrl("http://ai:8000/")).isEqualTo(URI.create("http://ai:8000"));
        assertThatThrownBy(() -> AiServiceConfig.parseBaseUrl("http://ai:8000/v1"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> AiServiceConfig.parseBaseUrl("ftp://ai"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> AiServiceConfig.parseBaseUrl("http://u:p@ai:8000"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 주소가_없으면_판단하지_않는_구현을_쓴다() {
        var properties = new AiServiceProperties();

        var decider = new AiServiceConfig().paceDecider(properties, JSON);

        assertThat(decider).isNotInstanceOf(AiPaceDecideHttpClient.class);
        assertThat(decider.decide(request())).isEmpty();
    }
}
