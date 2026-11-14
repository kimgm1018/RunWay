package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S15P31E105-820: Tomcat이 쿼리 문자열 파라미터를 해석하지 못하면(깨진 퍼센트 인코딩·잘못된 %) 500이 아니라 400 VALIDATION_ERROR(JSON)다.
 *
 * <p>MockMvc는 Tomcat의 파라미터 디코딩을 거치지 않아 이 결함을 재현하지 못한다. 그래서 실제 서버 포트로 퍼센트 인코딩된 URL을 그대로 보낸다.
 */
class SearchRequestEncodingIntegrationTest extends SharedContextIntegrationSupport {

    /**
     * 서로게이트 바이트(%ED%A0%BD), 잘못된 바이트, 과대 인코딩, 잘린 시퀀스, 16진수가 아닌 %, 끝의 %·불완전한 %. Tomcat은 모두 같은 예외로 거절한다.
     */
    private static final List<String> BROKEN_VALUES =
            List.of("a%ED%A0%BDz", "a%FFz", "%C0%80", "a%E3%81", "a%G1z", "a%", "a%E");

    @LocalServerPort private int port;
    @Autowired private JdbcTemplate jdbc;

    private final HttpClient client =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private long viewerId;

    @BeforeEach
    void seed() {
        viewerId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('enc_viewer','hash','인코딩조회자','2000-01-01','MALE','01050001000','AGREE')
                        RETURNING id
                        """,
                        Long.class);
        jdbc.update(
                "INSERT INTO crews(owner_id, name, capacity, status) VALUES (?, '새벽러닝', 10,"
                        + " 'ACTIVE'::crews_status_enum)",
                viewerId);
    }

    @Test
    void 해석할_수_없는_파라미터는_JSON_400이다() throws Exception {
        for (String broken : BROKEN_VALUES) {
            assertValidationError("/api/v1/search?q=" + broken);
            assertValidationError("/api/v1/search?q=" + broken + "&type=USER");
            assertValidationError("/api/v1/search?q=" + broken + "&type=CREW");
            assertValidationError("/api/v1/crews?q=" + broken);
            assertValidationError("/api/v1/crews?regionCode=" + broken);
        }
        // 다른 파라미터와 파라미터 이름이 깨진 경우도 같다.
        assertValidationError("/api/v1/search?q=abc&type=%ED%A0%BD");
        assertValidationError("/api/v1/search?q=abc&cursor=%ED%A0%BD");
        assertValidationError("/api/v1/search?q=abc&limit=%ED%A0%BD");
        assertValidationError("/api/v1/search?%ED%A0%BD=1&q=abc");
    }

    @Test
    void 깨진_인코딩_응답에는_입력값과_내부_문구가_없다() throws Exception {
        RawResponse response = rawGet("/api/v1/search?q=secretA%ED%A0%BDsecretZ");

        assertThat(response.status()).isEqualTo(400);
        assertThat(response.body())
                .doesNotContain("secretA", "secretZ", "%ED", "Parameter", "decoding")
                .doesNotContain("�");
        assertThat((Object) JsonPath.read(response.body(), "$.details"))
                .isEqualTo(java.util.Map.of());
    }

    @Test
    void 정상_인코딩은_그대로_처리되고_인증이_먼저다() throws Exception {
        // 한글, 이모지, 유효한 U+FFFD(%EF%BF%BD)는 깨진 인코딩이 아니다.
        assertThat(get("/api/v1/search?q=%EC%83%88%EB%B2%BD&type=CREW", true).statusCode())
                .isEqualTo(200);
        assertThat(get("/api/v1/search?q=%F0%9F%8F%83&type=USER", true).statusCode())
                .isEqualTo(200);
        assertThat(get("/api/v1/crews?q=%F0%9F%8F%83", true).statusCode()).isEqualTo(200);
        assertThat(get("/api/v1/search?q=a%EF%BF%BDz&type=USER", true).statusCode())
                .isEqualTo(200);
        HttpResponse<String> crews = get("/api/v1/search?q=%EC%83%88%EB%B2%BD&type=CREW", true);
        assertThat((Integer) JsonPath.read(crews.body(), "$.crews.length()")).isEqualTo(1);

        // 토큰이 없으면 깨진 인코딩이어도 401이 먼저다.
        for (String path : List.of("/api/v1/search?q=a%ED%A0%BDz", "/api/v1/crews?q=a%ED%A0%BDz")) {
            HttpResponse<String> unauthorized = get(path, false);
            assertThat(unauthorized.statusCode()).isEqualTo(401);
            assertThat((String) JsonPath.read(unauthorized.body(), "$.code"))
                    .isEqualTo("UNAUTHORIZED");
        }
    }

    private void assertValidationError(String path) throws Exception {
        // java.net.URI는 잘못된 %(`%G1z`·끝 `%`)를 거부하므로 원시 소켓으로 요청 줄을 그대로 보낸다.
        RawResponse response = rawGet(path);
        assertThat(response.status()).as(path).isEqualTo(400);
        assertThat(response.contentType()).as(path).startsWith("application/json");
        assertThat((String) JsonPath.read(response.body(), "$.code"))
                .as(path)
                .isEqualTo("VALIDATION_ERROR");
    }

    /** HTTP/1.0 요청이라 서버가 청크 없이 본문을 쓰고 연결을 닫는다. */
    private RawResponse rawGet(String path) throws Exception {
        try (Socket socket = new Socket("localhost", port)) {
            socket.setSoTimeout(10_000);
            String request =
                    "GET "
                            + path
                            + " HTTP/1.0\r\nHost: localhost\r\nAuthorization: "
                            + SecurityTestSupport.bearer(viewerId)
                            + "\r\n\r\n";
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();
            String raw =
                    new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int headerEnd = raw.indexOf("\r\n\r\n");
            String head = raw.substring(0, headerEnd);
            String statusLine = head.substring(0, head.indexOf("\r\n"));
            int status = Integer.parseInt(statusLine.split(" ")[1]);
            String contentType =
                    head.lines()
                            .filter(
                                    line ->
                                            line.toLowerCase(Locale.ROOT)
                                                    .startsWith("content-type:"))
                            .map(line -> line.substring("content-type:".length()).trim())
                            .findFirst()
                            .orElse("");
            return new RawResponse(status, contentType, raw.substring(headerEnd + 4));
        }
    }

    private record RawResponse(int status, String contentType, String body) {}

    private HttpResponse<String> get(String path, boolean authenticated) throws Exception {
        HttpRequest.Builder builder =
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .timeout(Duration.ofSeconds(10));
        if (authenticated) {
            builder.header("Authorization", SecurityTestSupport.bearer(viewerId));
        }
        return client.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
