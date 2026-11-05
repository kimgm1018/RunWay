package com.runway.backend.domain.auth;

import com.runway.backend.domain.auth.service.MemberPasswordHasher;
import com.runway.backend.support.SharedPostgres;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
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

    @BeforeEach
    void seedAuth() {
        try (var connection = redis.getConnectionFactory().getConnection()) {
            connection.serverCommands().flushDb();
        }
        jdbc.update("DELETE FROM user_settings");
        jdbc.update("DELETE FROM user_profiles");
        jdbc.update("DELETE FROM users");
        encoded = passwords.encode("Runner9!");
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
