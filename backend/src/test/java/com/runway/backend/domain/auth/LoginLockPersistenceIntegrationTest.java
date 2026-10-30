package com.runway.backend.domain.auth;

import static com.runway.backend.domain.auth.LoginAttemptStoreIntegrationTest.assertCode;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.repository.LoginAttemptStore;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.concurrent.TimeUnit;

class LoginLockPersistenceIntegrationTest {
    private final RefreshTokenStoreIntegrationTest support = new RefreshTokenStoreIntegrationTest();

    @Test
    void twoInstancesAndGracefulOrCrashRestartPreserveUnexpiredState() throws Exception {
        try (var server = support.container()) {
            server.start();
            String counting;
            String locked;
            try (var context = support.context(server, "default");
                    var second = support.context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var attempts = new LoginAttemptStore(redis);
                assertThat(attempts.recordFailure("runner01")).isEqualTo(1);
                var another = new LoginAttemptStore(second.getBean(StringRedisTemplate.class));
                assertThat(another.recordFailure("runner01")).isEqualTo(2);
                for (int i = 0; i < 5; i++) attempts.recordFailure("missing1");
                counting = redis.opsForValue().get(LoginAttemptStore.key("runner01"));
                locked = redis.opsForValue().get(LoginAttemptStore.key("missing1"));
            }
            for (boolean crash : new boolean[] {false, true}) {
                if (crash)
                    server.getDockerClient()
                            .killContainerCmd(server.getContainerId())
                            .withSignal("KILL")
                            .exec();
                else server.getDockerClient().stopContainerCmd(server.getContainerId()).exec();
                server.getDockerClient().startContainerCmd(server.getContainerId()).exec();
                for (int i = 0; i < 50; i++) {
                    try {
                        if (server.execInContainer(
                                        "redis-cli",
                                        "--no-auth-warning",
                                        "-a",
                                        RefreshTokenStoreIntegrationTest.PASSWORD,
                                        "PING")
                                .getStdout()
                                .contains("PONG")) break;
                    } catch (Exception ignored) {
                    }
                    TimeUnit.MILLISECONDS.sleep(100);
                }
                try (var context = support.context(server, "default")) {
                    var redis = context.getBean(StringRedisTemplate.class);
                    assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                            .isEqualTo(counting);
                    assertThat(redis.opsForValue().get(LoginAttemptStore.key("missing1")))
                            .isEqualTo(locked);
                    assertThat(redis.getExpire(LoginAttemptStore.key("runner01")))
                            .isBetween(86300L, 86400L);
                    assertThat(redis.getExpire(LoginAttemptStore.key("missing1")))
                            .isBetween(500L, 600L);
                    assertCode(
                            () -> new LoginAttemptStore(redis).ensureAllowed("missing1"),
                            "LOGIN_LOCKED");
                }
            }
        }
        // Represents the approved operator recovery, never automatic flush or production data.
        try (var fresh = support.container()) {
            fresh.start();
            try (var context = support.context(fresh, "default")) {
                var attempts = new LoginAttemptStore(context.getBean(StringRedisTemplate.class));
                attempts.ensureAllowed("missing1");
                assertThat(attempts.recordFailure("runner01")).isEqualTo(1);
            }
        }
    }
}
