package com.runway.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * S15P31E105-827: PUT·PATCH·DELETE의 application/x-www-form-urlencoded 본문은 이 API가 전혀 쓰지 않는 형태라 내용과
 * 관계없이 400 VALIDATION_ERROR로 거절한다. 이전에는 Spring FormContentFilter가 깨진 퍼센트 인코딩을 풀다 던진
 * IllegalArgumentException이 어디서도 잡히지 않아 500(Boot 기본 /error)이 났다.
 */
class FormBodyGuardIntegrationTest extends SharedContextIntegrationSupport {

    @LocalServerPort private int port;
    @Autowired private JdbcTemplate jdbc;

    private final HttpClient client =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private long userId;
    private String bearer;

    @BeforeEach
    void seed() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('form_guard','hash','폼가드조회자','2000-01-01','MALE','01050002000','AGREE')
                        RETURNING id
                        """,
                        Long.class);
        jdbc.update(
                """
                INSERT INTO user_settings(user_id,voice_coaching_enabled,bpm_guide_enabled,
                    group_notifications_enabled,community_notifications_enabled,
                    location_collection_mode,account_visibility)
                VALUES (?,true,true,true,true,'ALWAYS'::user_settings_location_collection_mode_enum,
                    'PUBLIC'::user_settings_account_visibility_enum)
                """,
                userId);
        bearer = SecurityTestSupport.bearer(userId);
    }

    @Test
    void PUT에_정상_폼_본문도_500이_아니라_400이다() throws Exception {
        assertValidationError(
                formRequest("PUT", "/api/v1/users/me/privacy-settings", "a=b"));
    }

    @Test
    void PUT에_깨진_퍼센트_인코딩_폼_본문도_400이다() throws Exception {
        assertValidationError(
                formRequest("PUT", "/api/v1/users/me/privacy-settings", "a=%zz"));
    }

    @Test
    void PATCH와_DELETE도_폼_본문을_같은_400으로_거절한다() throws Exception {
        assertValidationError(
                formRequest("PATCH", "/api/v1/users/me/privacy-settings", "a=%zz"));
        assertValidationError(formRequest("DELETE", "/api/v1/users/" + userId + "/follow", "a=%zz"));
    }

    @Test
    void 인증_없이_보낸_폼_본문도_401이_아니라_400이다() throws Exception {
        // FormContentFilter가 Spring Security보다 먼저 실행되도록 설계돼 있어(OrderedFormContentFilter
        // DEFAULT_ORDER Javadoc), 이 필터도 같은 자리에서 막는다. 인증 여부와 무관하게 400이다.
        HttpRequest request =
                HttpRequest.newBuilder(
                                URI.create(
                                        "http://localhost:"
                                                + port
                                                + "/api/v1/users/me/privacy-settings"))
                        .timeout(Duration.ofSeconds(10))
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .method("PUT", HttpRequest.BodyPublishers.ofString("a=b"))
                        .build();
        assertValidationError(client.send(request, HttpResponse.BodyHandlers.ofString()));
    }

    @Test
    void 같은_메서드의_JSON_본문은_회귀_없이_그대로_처리된다() throws Exception {
        HttpRequest request =
                HttpRequest.newBuilder(
                                URI.create(
                                        "http://localhost:"
                                                + port
                                                + "/api/v1/users/me/privacy-settings"))
                        .timeout(Duration.ofSeconds(10))
                        .header("Authorization", bearer)
                        .header("Content-Type", "application/json")
                        .method(
                                "PATCH",
                                HttpRequest.BodyPublishers.ofString("{\"isPrivate\":true}"))
                        .build();
        HttpResponse<String> response =
                client.send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
    }

    private HttpResponse<String> formRequest(String method, String path, String body)
            throws Exception {
        HttpRequest request =
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .timeout(Duration.ofSeconds(10))
                        .header("Authorization", bearer)
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .method(method, HttpRequest.BodyPublishers.ofString(body))
                        .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private void assertValidationError(HttpResponse<String> response) {
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat((String) JsonPath.read(response.body(), "$.code"))
                .isEqualTo("VALIDATION_ERROR");
    }
}
