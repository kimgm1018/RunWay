package com.runway.backend.infrastructure.sms;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.auth.verification.SmsPort.Result;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** AC-9·AC-12(T-10, T-13): 합성 HTTP 서버로 요청 형식과 결과 분류, 재시도 없음을 확인한다. 실제 SOLAPI는 부르지 않는다. */
class SolapiSmsClientTest {
    private static final String PATH = "/messages/v4/send-many/fast";
    private static final String OK = """
            {"groupInfo":{"groupId":"G-synthetic","count":{"total":1,"registeredFailed":0}},"failedMessageList":[]}
            """;
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final SmsProperties properties = new SmsProperties();
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> responseBody = new AtomicReference<>(OK);
    private final AtomicReference<String> method = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicReference<String> contentType = new AtomicReference<>();
    private final AtomicReference<byte[]> requestBody = new AtomicReference<>();
    private volatile long delayMs;
    private HttpServer server;
    private ExecutorService executor;

    @BeforeEach
    void setUp() throws IOException {
        properties.setEnabled(true);
        properties.getSolapi().setApiKey("synthetic-key");
        properties.getSolapi().setApiSecret("synthetic-secret");
        properties.getSolapi().setSenderNumber("01011112222");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext(PATH, exchange -> {
            calls.incrementAndGet();
            method.set(exchange.getRequestMethod());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            requestBody.set(exchange.getRequestBody().readAllBytes());
            if (delayMs > 0) sleep(delayMs);
            reply(exchange, status.get(), responseBody.get());
        });
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
        executor.shutdownNow();
    }

    private SolapiSmsClient client(Duration timeout) {
        Clock clock = Clock.fixed(Instant.parse("2026-11-09T03:00:00Z"), ZoneId.of("Asia/Seoul"));
        URI uri = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + PATH);
        return new SolapiSmsClient(properties, mapper, uri, timeout, clock, new SecureRandom());
    }

    private Result send() {
        return client(Duration.ofSeconds(2)).send("01033334444", "[Runway] 본인확인 인증번호 [123456]");
    }

    @Test
    void 접수되면_ACCEPTED이고_요청은_SDK와_같은_형식이다() {
        assertThat(send()).isEqualTo(Result.ACCEPTED);
        assertThat(calls).hasValue(1);
        assertThat(method.get()).isEqualTo("POST");
        assertThat(contentType.get()).isEqualTo("application/json");
        assertThat(authorization.get()).matches(
                "HMAC-SHA256 apiKey=synthetic-key, date=2026-11-09T12:00:00\\+09:00, salt=[0-9a-zA-Z]{32},"
                        + " signature=[0-9a-f]{64}");
        JsonNode message = mapper.readTree(requestBody.get()).get("messages").get(0);
        assertThat(message.get("to").asString()).isEqualTo("01033334444");
        assertThat(message.get("from").asString()).isEqualTo("01011112222");
        assertThat(message.get("text").asString()).contains("123456");
    }

    @Test
    void 접수_실패_목록이_있으면_REJECTED다() {
        responseBody.set("""
                {"groupInfo":{"count":{"total":1,"registeredFailed":1}},
                 "failedMessageList":[{"statusCode":"1062","statusMessage":"발신번호 미등록"}]}
                """);
        assertThat(send()).isEqualTo(Result.REJECTED);
    }

    @Test
    void 클라이언트_오류_4xx는_거절이고_다시_보내지_않는다() {
        for (int code : new int[] {400, 401, 403, 429}) {
            calls.set(0);
            status.set(code);
            responseBody.set("{\"errorCode\":\"synthetic\",\"errorMessage\":\"synthetic\"}");
            assertThat(send()).as("status %d", code).isEqualTo(Result.REJECTED);
            assertThat(calls).hasValue(1);
        }
    }

    @Test
    void 서버_오류_5xx와_리다이렉트는_결과_불명확이고_다시_보내지_않는다() {
        for (int code : new int[] {500, 502, 503, 302}) {
            calls.set(0);
            status.set(code);
            assertThat(send()).as("status %d", code).isEqualTo(Result.UNKNOWN);
            assertThat(calls).hasValue(1);
        }
    }

    @Test
    void 시간_초과는_결과_불명확이고_다시_보내지_않는다() {
        delayMs = 1_500;
        assertThat(client(Duration.ofMillis(300)).send("01033334444", "text")).isEqualTo(Result.UNKNOWN);
        assertThat(calls).hasValue(1);
    }

    @Test
    void 읽을_수_없거나_너무_큰_본문은_결과_불명확이다() {
        responseBody.set("not-json");
        assertThat(send()).isEqualTo(Result.UNKNOWN);
        responseBody.set("{\"failedMessageList\":[],\"pad\":\"" + "x".repeat(SolapiSmsClient.MAX_BYTES) + "\"}");
        assertThat(send()).isEqualTo(Result.UNKNOWN);
    }

    @Test
    void 요청을_만들지_못하면_보내지_않고_거절이다() {
        // 리뷰 R-9: 헤더에 넣을 수 없는 키, 빠진 발신번호. 발송 전 실패라 500이 아니라 거절(503 SMS_UNAVAILABLE)로 처리한다.
        properties.getSolapi().setApiKey("synthetic\r\nkey");
        assertThat(send()).isEqualTo(Result.REJECTED);
        properties.getSolapi().setApiKey("synthetic-key");
        properties.getSolapi().setSenderNumber(null);
        assertThat(send()).isEqualTo(Result.REJECTED);
        assertThat(calls).hasValue(0);
    }

    @Test
    void 꺼져_있으면_보내지_않는다() {
        properties.setEnabled(false);
        var client = client(Duration.ofSeconds(2));
        assertThat(client.enabled()).isFalse();
        assertThat(client.send("01033334444", "text")).isEqualTo(Result.REJECTED);
        assertThat(calls).hasValue(0);
    }

    private static void reply(HttpExchange exchange, int code, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        if (code == 302) exchange.getResponseHeaders().add("Location", "http://127.0.0.1:1/elsewhere");
        exchange.sendResponseHeaders(code, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        } catch (IOException ignored) {
            // 클라이언트가 시간 초과로 먼저 끊을 수 있다.
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
