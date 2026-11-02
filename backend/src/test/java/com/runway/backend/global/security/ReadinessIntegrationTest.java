package com.runway.backend.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.anyBoolean;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.availability.AvailabilityChangeEvent;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "management.server.port=0")
@Testcontainers
class ReadinessIntegrationTest {
    @Container
    static final PostgreSQLContainer DATABASE =
            new PostgreSQLContainer(DockerImageName.parse("postgis/postgis:17-3.6")
                    .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @LocalServerPort private int mainPort;
    @Autowired private Environment environment;
    @Autowired private ConfigurableApplicationContext context;
    @MockitoBean(name = "dbHealthIndicator") private HealthIndicator database;
    @MockitoBean(name = "redisHealthIndicator") private HealthIndicator redis;

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    @BeforeEach
    void 정상상태로_시작한다() {
        when(database.health(anyBoolean())).thenReturn(Health.up().build());
        when(redis.health(anyBoolean())).thenReturn(Health.up().build());
        AvailabilityChangeEvent.publish(context, ReadinessState.ACCEPTING_TRAFFIC);
    }

    private int managementPort() {
        return environment.getRequiredProperty("local.management.port", Integer.class);
    }

    private HttpResponse<String> request(int port, String path, String method) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .method(method, HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void 내부관리포트에서만_200_UP를_공개한다() throws Exception {
        var response = request(managementPort(), "/actuator/health/readiness", "GET");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"status\":\"UP\"}");
        assertThat(request(mainPort, "/actuator/health/readiness", "GET").statusCode())
                .isNotEqualTo(200);
        assertThat(request(mainPort, "/api/v1/devices", "GET").statusCode()).isEqualTo(401);
    }

    @Test
    void DB또는_Redis장애는_503이고_상세를_숨긴다() throws Exception {
        for (var indicator : new HealthIndicator[] {database, redis}) {
            when(indicator.health(anyBoolean())).thenReturn(Health.down()
                    .withDetail("error", "synthetic-sensitive-marker").build());
            var response = request(managementPort(), "/actuator/health/readiness", "GET");
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(response.body()).isEqualTo("{\"status\":\"DOWN\"}");
            when(indicator.health(anyBoolean())).thenReturn(Health.up().build());
        }
    }

    @Test
    void 앱이_요청거절상태면_배포성공으로_판단하지않는다() throws Exception {
        AvailabilityChangeEvent.publish(context, ReadinessState.REFUSING_TRAFFIC);
        assertThat(request(managementPort(), "/actuator/health/readiness", "GET").statusCode())
                .isEqualTo(503);
    }

    @Test
    void 다른관리주소와_쓰기요청은_차단한다() throws Exception {
        for (String path : new String[] {"/actuator", "/actuator/health", "/actuator/env",
                "/actuator/beans", "/v3/api-docs", "/api/v1/auth/login"}) {
            assertThat(request(managementPort(), path, "GET").statusCode()).isNotEqualTo(200);
        }
        for (String method : new String[] {"POST", "PUT", "DELETE", "HEAD"}) {
            assertThat(request(managementPort(), "/actuator/health/readiness", method).statusCode())
                    .isNotEqualTo(200);
        }
    }
}
