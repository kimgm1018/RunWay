package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.config.AuthenticationRedisConfig.RedisSettings;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class RedisSettingsTest {
    MockEnvironment valid() {
        return new MockEnvironment()
                .withProperty("runway.auth.redis.host", "127.0.0.1")
                .withProperty("runway.auth.redis.port", "6379")
                .withProperty("runway.auth.redis.username", "runway_app")
                .withProperty("runway.auth.redis.password", "synthetic-secret-only");
    }

    @Test
    void requiredAndMalformedSettingsDoNotExposeSecrets() {
        assertThatThrownBy(() -> RedisSettings.load(new MockEnvironment()))
                .hasMessageContaining("BACKEND_REDIS_PASSWORD");
        assertThatThrownBy(
                        () ->
                                RedisSettings.load(
                                        valid().withProperty(
                                                        "runway.auth.redis.port",
                                                        "synthetic-secret-only")))
                .hasMessage("BACKEND_REDIS_PORT 형식 오류");
        assertThatThrownBy(
                        () ->
                                RedisSettings.load(
                                        valid().withProperty(
                                                        "runway.auth.redis.host",
                                                        "redis://name:synthetic-secret-only@localhost")))
                .hasMessage("BACKEND_REDIS_HOST 형식 오류");
        assertThat(RedisSettings.load(valid()).toString()).doesNotContain("synthetic-secret-only");
    }
}
