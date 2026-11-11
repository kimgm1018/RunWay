package com.runway.backend.infrastructure.naver;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonPoint;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class NaverPlaceSearchClientTest {
    private static final String LOCAL = """
            {"items":[{"title":"<b>공원</b> &amp; 입구","roadAddress":"도로 1","address":"지번 1",
            "mapx":"1291180000","mapy":"351530000"}]}
            """;
    private static final String ADDRESS = """
            {"status":"OK","addresses":[{"roadAddress":"도로 2","jibunAddress":"지번 2",
            "x":"129.12","y":"35.16"}]}
            """;
    private HttpServer server;
    private ExecutorService executor;
    private final AtomicReference<String> localBody = new AtomicReference<>(LOCAL);
    private final AtomicReference<String> addressBody = new AtomicReference<>(ADDRESS);
    private final AtomicInteger localStatus = new AtomicInteger(200);
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicReference<String> requestQuery = new AtomicReference<>();
    private final AtomicReference<String> header = new AtomicReference<>();
    private final AtomicReference<String> secretHeader = new AtomicReference<>();
    private volatile long bodyDelay;
    private final PlaceSearchProperties properties = new PlaceSearchProperties();

    @BeforeEach
    void setUp() throws IOException {
        properties.setEnabled(true);
        properties.setSearchClientId("synthetic-id");
        properties.setSearchClientSecret("synthetic-secret");
        properties.setMapsKeyId("synthetic-map-id");
        properties.setMapsKey("synthetic-map-secret");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/local", exchange -> {
            calls.incrementAndGet();
            header.set(exchange.getRequestHeaders().getFirst("X-NCP-APIGW-API-KEY-ID"));
            secretHeader.set(exchange.getRequestHeaders().getFirst("X-NCP-APIGW-API-KEY"));
            reply(exchange, localStatus.get(), localBody.get());
        });
        server.createContext("/address", exchange -> {
            requestQuery.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, 200, addressBody.get());
        });
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
        executor.shutdownNow();
    }

    private void reply(HttpExchange exchange, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.getResponseHeaders().add("Location", base() + "/address");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            if (bodyDelay > 0) {
                try { Thread.sleep(bodyDelay); } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            out.write(bytes);
        }
    }

    private URI base() { return URI.create("http://127.0.0.1:" + server.getAddress().getPort()); }

    private NaverPlaceSearchClient client(Duration timeout) {
        return new NaverPlaceSearchClient(properties, JsonMapper.builder().build(),
                base().resolve("/local"), base().resolve("/address"), timeout);
    }

    @Test
    void searchesBothSourcesAndNormalizesWgs84AndNames() {
        var places = client(Duration.ofSeconds(3)).search("공원 &+", GeoJsonPoint.of(129, 35));
        assertThat(places).hasSize(2);
        assertThat(places.getFirst().name()).isEqualTo("공원 & 입구");
        assertThat(places.getFirst().address()).isEqualTo("도로 1");
        assertThat(places.getFirst().position().coordinates()).containsExactly(129.118, 35.153);
        assertThat(places.getLast().name()).isEqualTo("도로 2");
        assertThat(places.getLast().position().coordinates()).containsExactly(129.12, 35.16);
        assertThat(requestQuery.get()).contains("%26%2B", "coordinate=129.0,35.0", "count=5");
        assertThat(header.get()).isEqualTo("synthetic-id");
        assertThat(secretHeader.get()).isEqualTo("synthetic-secret");
        assertThat(calls).hasValue(1);
    }

    @Test
    void acceptsDecimalWgs84FromApiHub() {
        localBody.set(LOCAL.replace("1291180000", "129.118").replace("351530000", "35.153"));
        assertThat(client(Duration.ofSeconds(3)).search("공원", null).getFirst().position().coordinates())
                .containsExactly(129.118, 35.153);
    }

    @Test
    void returnsEmptyOnlyForSuccessfulEmptyResponsesAndFallsBackToJibun() {
        localBody.set("{\"items\":[]}");
        addressBody.set("{\"status\":\"OK\",\"addresses\":[]}");
        assertThat(client(Duration.ofSeconds(3)).search("공원", null)).isEmpty();
        localBody.set(LOCAL.replace("도로 1", ""));
        assertThat(client(Duration.ofSeconds(3)).search("공원", null).getFirst().address())
                .isEqualTo("지번 1");
        assertThat(requestQuery.get()).doesNotContain("coordinate");
    }

    @Test
    void mapsAuthenticationQuotaServerAndRedirectFailuresWithoutRetryOrLeakingBody() {
        for (int status : new int[] {401, 429, 500, 302}) {
            localStatus.set(status);
            localBody.set("synthetic-provider-sensitive-body");
            int before = calls.get();
            assertUnavailable(client(Duration.ofSeconds(3)));
            assertThat(calls.get()).isEqualTo(before + 1);
        }
    }

    @Test
    void rejectsMalformedJsonCoordinatesAndShapes() {
        for (String body : new String[] {"not-json", "{}", "{\"items\":null}",
                LOCAL.replace("1291180000", "NaN"), LOCAL.replace("351530000", "951530000"),
                LOCAL.replace("<b>공원</b> &amp; 입구", "")}) {
            localBody.set(body);
            assertUnavailable(client(Duration.ofSeconds(3)));
        }
        localBody.set(LOCAL);
        addressBody.set("{\"status\":\"SYSTEM_ERROR\",\"addresses\":[]}");
        assertUnavailable(client(Duration.ofSeconds(3)));
    }

    @Test
    void enforcesBodySizeLimit() {
        localBody.set("x".repeat(NaverPlaceSearchClient.MAX_BYTES + 1));
        assertUnavailable(client(Duration.ofSeconds(3)));
    }

    @Test
    void pathologicalTagNameWithinBodyLimitIsRejectedPromptly() {
        localBody.set(LOCAL.replace("<b>공원</b> &amp; 입구", "<".repeat(120000)));
        long start = System.nanoTime();
        assertUnavailable(client(Duration.ofSeconds(3)));
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(2));
    }

    @Test
    void unterminatedTagNeverTriggersBacktracking() {
        localBody.set(LOCAL.replace("<b>공원</b> &amp; 입구", "공원" + "<".repeat(1000)));
        assertThat(client(Duration.ofSeconds(3)).search("공원", null).getFirst().name())
                .isEqualTo("공원");
    }

    @Test
    void overallDeadlineIncludesSlowResponseBody() {
        bodyDelay = 1500;
        long start = System.nanoTime();
        assertUnavailable(client(Duration.ofMillis(250)));
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(1));
    }

    private void assertUnavailable(NaverPlaceSearchClient client) {
        assertThatThrownBy(() -> client.search("공원", null))
                .isInstanceOf(ApiException.class)
                .hasMessage("일시적으로 처리할 수 없습니다.").hasNoCause();
    }
}
