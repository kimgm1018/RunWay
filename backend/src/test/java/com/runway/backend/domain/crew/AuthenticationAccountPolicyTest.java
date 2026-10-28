package com.runway.backend.domain.crew;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.runway.backend.global.security.JwtAccessTokenService;
import com.runway.backend.global.security.SecurityTestSupport;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
@Import(AuthenticationAccountPolicyTest.TimeConfiguration.class)
class AuthenticationAccountPolicyTest {
    static String expiredToken(long userId) {
        Instant then = Instant.now().minusSeconds(700);
        var issuer =
                new JwtAccessTokenService(
                        new NimbusJwtEncoder(
                                new ImmutableSecret<>(
                                        Base64.getDecoder().decode(SecurityTestSupport.KEY))),
                        Clock.fixed(then, ZoneOffset.UTC));
        return issuer.issue(userId, then.plusSeconds(3600)).accessToken();
    }

    @Container
    static final PostgreSQLContainer DATABASE =
            new PostgreSQLContainer(
                    DockerImageName.parse("postgis/postgis:17-3.6")
                            .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtAccessTokenService tokens;
    @Autowired MutableClock clock;

    @Test
    void 탈퇴후_기존토큰은_잔여기간만_허용하며_소유권은_유지한다() throws Exception {
        long first = CrewAuthenticationIntegrationTest.seedUser(jdbc, "first");
        long second = CrewAuthenticationIntegrationTest.seedUser(jdbc, "second");
        Instant issued = clock.instant();
        String a = "Bearer " + tokens.issue(first, issued.plusSeconds(3600)).accessToken();
        String b = "Bearer " + tokens.issue(second, issued.plusSeconds(3600)).accessToken();
        mvc.perform(
                        post("/api/v1/crews")
                                .header("Authorization", a)
                                .contentType("application/json")
                                .content("{\"name\":\"withdrawal policy\",\"capacity\":10}"))
                .andExpect(status().isCreated());
        long crew = jdbc.queryForObject("SELECT id FROM crews", Long.class);
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                second);
        clock.now = issued.plusSeconds(599);
        mvc.perform(get("/api/v1/users/me/crews").header("Authorization", b))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/posts").header("Authorization", b)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/crews/" + crew + "/join-requests").header("Authorization", b))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));
        clock.now = issued.plusSeconds(600);
        mvc.perform(get("/api/v1/users/me/crews").header("Authorization", b))
                .andExpect(status().isUnauthorized());
        clock.now = issued.plusSeconds(601);
        mvc.perform(get("/api/v1/users/me/crews").header("Authorization", b))
                .andExpect(status().isUnauthorized());
    }

    static class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-10-28T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TimeConfiguration {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }
}
