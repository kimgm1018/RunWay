package com.runway.backend.infrastructure.ai;

import static org.assertj.core.api.Assertions.assertThat;
import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.personalization.Ai06PersonalizeRequest;
import com.runway.backend.domain.user.personalization.Ai06Sample;
import com.runway.backend.domain.user.personalization.Ai06Session;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult.Reason;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class AiHrPersonalizeClientTest {

    private static final long USER_ID = 7L;
    private static final String OK_BODY =
            """
            {"schemaVersion":"runway.ode.personalization.v1","userId":7,
             "modelVersion":"ode-v21","createdAt":"2026-11-05T00:00:00Z","supportRunCount":3,
             "summaryU":{"f1":1.5,"f2":null},"hrRefBpm":120.5,
             "history8":[[1,2,3,4,5],[6,7,8,9,10]],"p4":[0.1,0.2,0.3,0.4],
             "hr0SubBpm":85,"hrDangerBpm":181.25,"hrSustainBpm":170,"hrThresholdRunCount":12,
             "warnings":["GRU_PERSONALIZATION_DISABLED"],"gruPersonalization":{"head":{"x":[1]}}}
            """;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final Queue<Scripted> script = new ArrayDeque<>();
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private HttpServer server;

    private record Scripted(int status, Map<String, String> headers, String body) {}

    private record Received(String method, String path, String contentType, String body) {}

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                exchange -> {
                    received.add(
                            new Received(
                                    exchange.getRequestMethod(),
                                    exchange.getRequestURI().getPath(),
                                    exchange.getRequestHeaders().getFirst("Content-Type"),
                                    new String(
                                            exchange.getRequestBody().readAllBytes(),
                                            StandardCharsets.UTF_8)));
                    Scripted next;
                    synchronized (script) {
                        next = script.poll();
                    }
                    if (next == null) {
                        next = new Scripted(500, Map.of(), "{}");
                    }
                    byte[] payload = next.body().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    next.headers().forEach((k, v) -> exchange.getResponseHeaders().add(k, v));
                    exchange.sendResponseHeaders(next.status(), payload.length);
                    try (OutputStream out = exchange.getResponseBody()) {
                        out.write(payload);
                    }
                    exchange.close();
                });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void respond(int status, String body, String... headerPairs) {
        Map<String, String> headers = new java.util.LinkedHashMap<>();
        for (int i = 0; i < headerPairs.length; i += 2) {
            headers.put(headerPairs[i], headerPairs[i + 1]);
        }
        synchronized (script) {
            script.add(new Scripted(status, headers, body));
        }
    }

    private AiHrPersonalizeClient client(int maxRetries) {
        URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        return new AiHrPersonalizeClient(
                HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build(),
                base,
                Duration.ofSeconds(5),
                maxRetries,
                Duration.ofSeconds(30),
                jsonMapper);
    }

    private static Ai06PersonalizeRequest request() {
        Ai06Sample sample =
                new Ai06Sample(
                        0,
                        97.0,
                        null,
                        null,
                        Ai06Sample.Quality.GOOD,
                        Ai06Sample.Quality.MISSING,
                        Ai06Sample.Quality.MISSING,
                        false);
        Ai06Session session =
                new Ai06Session(
                        9002L,
                        Instant.parse("2026-11-01T00:00:02Z"),
                        Ai06Session.WorkoutQuality.CLEAN,
                        List.of(sample));
        return new Ai06PersonalizeRequest(USER_ID, List.of(session));
    }

    @Test
    void 요청은_AI06_계약_필드명으로_직렬화한다() {
        respond(200, OK_BODY);

        client(3).personalize(request());

        assertThat(received).hasSize(1);
        Received call = received.getFirst();
        assertThat(call.method()).isEqualTo("POST");
        assertThat(call.path()).isEqualTo("/v1/hr/personalize");
        assertThat(call.contentType()).isEqualTo("application/json");
        JsonNode body = jsonMapper.readTree(call.body());
        assertThat(body.get("userId").longValue()).isEqualTo(USER_ID);
        JsonNode session = body.get("sessions").get(0);
        assertThat(session.get("sessionId").longValue()).isEqualTo(9002L);
        assertThat(session.get("sessionStartedAt").stringValue())
                .isEqualTo("2026-11-01T00:00:02Z");
        assertThat(session.get("workoutQuality").stringValue()).isEqualTo("CLEAN");
        JsonNode sample = session.get("samples").get(0);
        assertThat(sample.get("elapsedSec").intValue()).isZero();
        assertThat(sample.get("hrBpm").doubleValue()).isEqualTo(97.0);
        assertThat(sample.has("speedMps")).isTrue();
        assertThat(sample.get("speedMps").isNull()).isTrue();
        assertThat(sample.get("gradePercent").isNull()).isTrue();
        assertThat(sample.get("hrQuality").stringValue()).isEqualTo("GOOD");
        assertThat(sample.get("speedQuality").stringValue()).isEqualTo("MISSING");
        assertThat(sample.get("gradeQuality").stringValue()).isEqualTo("MISSING");
        assertThat(sample.get("hrIsFilled").booleanValue()).isFalse();
    }

    @Test
    void 성공_응답을_저장_명령으로_매핑하고_gru와_경고는_버린다() {
        respond(200, OK_BODY);

        HrPersonalizeResult result = client(3).personalize(request());

        assertThat(result).isInstanceOf(HrPersonalizeResult.Success.class);
        HrPersonalizationCommand command = ((HrPersonalizeResult.Success) result).command();
        assertThat(command.schemaVersion()).isEqualTo("runway.ode.personalization.v1");
        assertThat(command.modelVersion()).isEqualTo("ode-v21");
        assertThat(command.supportRunCount()).isEqualTo(3);
        assertThat(jsonMapper.readTree(command.summaryUJson()).get("f1").doubleValue())
                .isEqualTo(1.5);
        assertThat(jsonMapper.readTree(command.summaryUJson()).get("f2").isNull()).isTrue();
        assertThat(jsonMapper.readTree(command.history8Json()).size()).isEqualTo(2);
        assertThat(jsonMapper.readTree(command.p4Json()).size()).isEqualTo(4);
        assertThat(command.hr0SubBpm()).isEqualByComparingTo("85");
        assertThat(command.hrRefBpm()).isEqualByComparingTo("120.5");
        // +3 하지 않은 원값 그대로
        assertThat(command.hrDangerBpm()).isEqualByComparingTo(new BigDecimal("181.25"));
        assertThat(command.hrSustainBpm()).isEqualByComparingTo("170");
        assertThat(command.hrThresholdRunCount()).isEqualTo(12);
        assertThat(received).hasSize(1);
    }

    @Test
    void 선택_필드가_없으면_null로_매핑한다() {
        respond(
                200,
                """
                {"schemaVersion":"v1","userId":7,"modelVersion":"m","supportRunCount":0,
                 "summaryU":{},"history8":[],"p4":[0,0,0,0],"hr0SubBpm":85}
                """);

        HrPersonalizeResult result = client(3).personalize(request());

        HrPersonalizationCommand command = ((HrPersonalizeResult.Success) result).command();
        assertThat(command.hrRefBpm()).isNull();
        assertThat(command.hrDangerBpm()).isNull();
        assertThat(command.hrSustainBpm()).isNull();
        assertThat(command.hrThresholdRunCount()).isNull();
    }

    @Test
    void AI_BUSY는_RetryAfter_뒤_재시도해_성공하면_성공이다() {
        respond(503, "{\"code\":\"AI_BUSY\"}", "Retry-After", "0");
        respond(503, "{\"code\":\"AI_BUSY\"}", "Retry-After", "0");
        respond(200, OK_BODY);

        HrPersonalizeResult result = client(3).personalize(request());

        assertThat(result).isInstanceOf(HrPersonalizeResult.Success.class);
        assertThat(received).hasSize(3);
    }

    @Test
    void AI_BUSY가_계속되면_최대_재시도_횟수_뒤_실패한다() {
        for (int i = 0; i < 6; i++) {
            respond(503, "{\"code\":\"AI_BUSY\"}", "Retry-After", "0");
        }

        HrPersonalizeResult result = client(3).personalize(request());

        // 첫 시도 1 + 재시도 3
        assertThat(received).hasSize(4);
        assertThat(result)
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.BUSY_RETRIES_EXHAUSTED, 503));
    }

    @Test
    void 입력_부족_422는_재시도하지_않고_저장_대상이_아니다() {
        respond(422, "{\"code\":\"INPUT_INSUFFICIENT\",\"message\":\"x\"}");

        HrPersonalizeResult result = client(3).personalize(request());

        assertThat(result).isInstanceOf(HrPersonalizeResult.InputInsufficient.class);
        assertThat(received).hasSize(1);
    }

    @Test
    void 그_밖의_422와_5xx는_재시도하지_않고_실패한다() {
        respond(422, "{\"code\":\"VALIDATION_ERROR\"}");

        assertThat(client(3).personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.HTTP_ERROR, 422));
        assertThat(received).hasSize(1);

        respond(500, "{\"code\":\"INTERNAL\"}");
        assertThat(client(3).personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.HTTP_ERROR, 500));
        assertThat(received).hasSize(2);
    }

    @Test
    void 코드가_없는_503은_AI_BUSY가_아니므로_재시도하지_않는다() {
        respond(503, "{\"code\":\"UNAVAILABLE\"}", "Retry-After", "0");

        HrPersonalizeResult result = client(3).personalize(request());

        assertThat(result).isEqualTo(new HrPersonalizeResult.Failure(Reason.HTTP_ERROR, 503));
        assertThat(received).hasSize(1);
    }

    @Test
    void 계약을_벗어난_2xx_응답은_실패이며_저장_대상이_아니다() {
        respond(200, "{\"schemaVersion\":\"v1\",\"userId\":7}");

        assertThat(client(3).personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.INVALID_RESPONSE, 0));

        respond(200, "not-json");
        assertThat(client(3).personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.INVALID_RESPONSE, 0));
    }

    @Test
    void 응답의_회원ID가_다르면_실패한다() {
        respond(200, OK_BODY.replace("\"userId\":7", "\"userId\":8"));

        assertThat(client(3).personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.INVALID_RESPONSE, 0));
    }

    @Test
    void 응답이_본문_상한을_넘으면_실패한다() {
        String huge = "x".repeat(AiHrPersonalizeClient.MAX_RESPONSE_BYTES + 1);
        respond(200, "{\"pad\":\"" + huge + "\"}");

        assertThat(client(3).personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.INVALID_RESPONSE, 0));
    }

    @Test
    void 주소가_없으면_호출하지_않고_UNAVAILABLE이다() {
        AiHrPersonalizeClient noBase =
                new AiHrPersonalizeClient(
                        HttpClient.newHttpClient(),
                        null,
                        Duration.ofSeconds(1),
                        3,
                        Duration.ofSeconds(30),
                        jsonMapper);

        assertThat(noBase.personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.UNAVAILABLE, 0));
        assertThat(received).isEmpty();
    }

    @Test
    void 연결할_수_없으면_재시도하지_않고_UNAVAILABLE이다() {
        int port = server.getAddress().getPort();
        server.stop(0);
        AiHrPersonalizeClient client =
                new AiHrPersonalizeClient(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build(),
                        URI.create("http://127.0.0.1:" + port),
                        Duration.ofSeconds(2),
                        3,
                        Duration.ofSeconds(30),
                        jsonMapper);

        assertThat(client.personalize(request()))
                .isEqualTo(new HrPersonalizeResult.Failure(Reason.UNAVAILABLE, 0));
    }

    @Test
    void RetryAfter는_상한_안으로_맞춘다() {
        AiHrPersonalizeClient client = client(3);

        assertThat(client.retryDelay(headers("Retry-After", "5"))).isEqualTo(Duration.ofSeconds(5));
        assertThat(client.retryDelay(headers("Retry-After", "999")))
                .isEqualTo(Duration.ofSeconds(30));
        assertThat(client.retryDelay(headers("Retry-After", "0"))).isEqualTo(Duration.ZERO);
        assertThat(client.retryDelay(headers("Retry-After", "-4"))).isEqualTo(Duration.ZERO);
        assertThat(client.retryDelay(headers("Retry-After", "garbage")))
                .isEqualTo(AiHrPersonalizeClient.DEFAULT_RETRY_AFTER);
        assertThat(client.retryDelay(HttpHeaders.of(Map.of(), (a, b) -> true)))
                .isEqualTo(AiHrPersonalizeClient.DEFAULT_RETRY_AFTER);
    }

    @Test
    void RetryAfter_HTTP_date도_상한_안으로_해석한다() {
        AiHrPersonalizeClient client = client(3);
        String farFuture = "Wed, 21 Oct 2037 07:28:00 GMT";
        String past = "Wed, 21 Oct 2015 07:28:00 GMT";

        assertThat(client.retryDelay(headers("Retry-After", farFuture)))
                .isEqualTo(Duration.ofSeconds(30));
        assertThat(client.retryDelay(headers("Retry-After", past))).isEqualTo(Duration.ZERO);
    }

    @Test
    void 요청_객체_toString은_값을_숨긴다() {
        assertThat(request().toString()).isEqualTo("Ai06PersonalizeRequest[REDACTED]");
    }

    private static HttpHeaders headers(String name, String value) {
        return HttpHeaders.of(Map.of(name, List.of(value)), (a, b) -> true);
    }
}
