package com.runway.backend.domain.auth;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.MemberPasswordHasher;
import com.runway.backend.domain.user.repository.ProfileOwnerLockRepository;
import com.runway.backend.domain.user.repository.UserProfileRepository;
import com.runway.backend.global.security.JwtAccessTokenService;
import com.runway.backend.support.SharedPostgres;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 인증 통합 테스트 공통 준비. 하위 클래스가 Spy로 쓰는 빈을 모두 여기서 선언해 Spring 컨텍스트 하나를 함께 쓴다. Spy는 스텁하지 않으면
 * 실제 빈과 같게 동작하고 테스트마다 초기화된다. 하위 클래스는 같은 빈을 {@code @Autowired}로 받아 스텁한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@MockitoSpyBean(
        types = {
            MemberPasswordHasher.class,
            RefreshTokenStore.class,
            JwtAccessTokenService.class,
            SignupRepository.class,
            ProfileOwnerLockRepository.class,
            UserProfileRepository.class
        })
abstract class AuthIntegrationSupport {
    static final String REDIS_IMAGE =
            "redis:8.2.11@sha256:dae6b6fcd9e26c1e73cf70323f0711d4c1ade5bf40c1dfd9aa24d0fbb57e2309";
    static final String TEST_PASSWORD = "synthetic-redis-test-only";
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(AuthIntegrationSupport.class);
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse(REDIS_IMAGE))
                    .withExposedPorts(6379)
                    .withCommand(
                            "redis-server",
                            "--appendonly",
                            "yes",
                            "--appendfsync",
                            "always",
                            "--aof-load-truncated",
                            "no",
                            "--maxmemory",
                            "256mb",
                            "--maxmemory-policy",
                            "noeviction",
                            "--save",
                            "",
                            "--requirepass",
                            TEST_PASSWORD);

    static {
        REDIS.start();
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.auth.redis.host", REDIS::getHost);
        registry.add("runway.auth.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("runway.auth.redis.username", () -> "default");
        registry.add("runway.auth.redis.password", () -> TEST_PASSWORD);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired MemberPasswordHasher passwords;
    long user;
    String encoded;

    /** 준비 데이터만 재사용한다. 실제 요청의 해싱과 Spy 호출 이력은 각 테스트가 검증한다. */
    private static final class SeedPassword {
        static final String ENCODED = new MemberPasswordHasher().encode("Runner9!");
    }

    @BeforeEach
    void seedAuth() {
        try (var connection = redis.getConnectionFactory().getConnection()) {
            connection.serverCommands().flushDb();
        }
        jdbc.update("DELETE FROM user_settings");
        jdbc.update("DELETE FROM user_profiles");
        jdbc.update("DELETE FROM users");
        encoded = SeedPassword.ENCODED;
        user =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('runner01',?,'러너','2000-01-01','MALE','01000000000','DISAGREE') RETURNING id
                        """,
                        Long.class,
                        encoded);
    }
}
