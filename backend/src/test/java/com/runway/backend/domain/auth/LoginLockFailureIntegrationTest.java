package com.runway.backend.domain.auth;

import static com.runway.backend.domain.auth.LoginAttemptStoreIntegrationTest.assertCode;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.config.AuthenticationRedisConfig;
import com.runway.backend.domain.auth.repository.LoginAttemptStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.mock.env.MockEnvironment;

import java.time.Instant;

class LoginLockFailureIntegrationTest {
    private final RefreshTokenStoreIntegrationTest support = new RefreshTokenStoreIntegrationTest();

    @Test
    void actualLostFailureReplyIsNotReplayedOrTreatedAsNoWrite() throws Exception {
        transportFault(RedisReplyProxy.Fault.LOSE_REPLY);
    }

    @Test
    void actualDisconnectBeforeFailureWriteDoesNotMutateOrReplay() throws Exception {
        transportFault(RedisReplyProxy.Fault.DISCONNECT_BEFORE_WRITE);
    }

    private void transportFault(RedisReplyProxy.Fault fault) throws Exception {
        try (var server = support.container()) {
            server.start();
            try (var context = support.context(server, "default")) {
                var direct = context.getBean(StringRedisTemplate.class);
                var script = new DefaultRedisScript<Long>();
                script.setLocation(new ClassPathResource("auth/login-attempt.lua"));
                script.setResultType(Long.class);
                new LoginAttemptStore(direct).ensureAllowed("runner01"); // Warm EVALSHA.
                try (var proxy =
                                new RedisReplyProxy(
                                        server.getHost(),
                                        server.getMappedPort(6379),
                                        script.getSha1());
                        var proxied = proxyContext(proxy)) {
                    var attempts =
                            new LoginAttemptStore(proxied.getBean(StringRedisTemplate.class));
                    attempts.ensureAllowed("runner01");
                    proxy.arm(fault);
                    assertCode(() -> attempts.recordFailure("runner01"), "SERVICE_UNAVAILABLE");
                    assertThat(proxy.createRequests.get()).isEqualTo(1);
                    String value = direct.opsForValue().get(LoginAttemptStore.key("runner01"));
                    if (fault == RedisReplyProxy.Fault.LOSE_REPLY) {
                        assertThat(value).startsWith("1:");
                        assertThat(direct.getExpire(LoginAttemptStore.key("runner01")))
                                .isBetween(86380L, 86400L);
                    } else assertThat(value).isNull();
                }
            }
        }
    }

    @Test
    void memoryPressurePreservesPriorCounterAndBlocksIssuance() {
        try (var server = support.container()) {
            server.start();
            try (var context = support.context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var attempts = new LoginAttemptStore(redis);
                attempts.recordFailure("runner01");
                String before = redis.opsForValue().get(LoginAttemptStore.key("runner01"));
                try (var connection = redis.getConnectionFactory().getConnection()) {
                    connection.serverCommands().setConfig("maxmemory", "1");
                }
                assertCode(() -> attempts.recordFailure("runner01"), "SERVICE_UNAVAILABLE");
                var token = new RefreshTokenFactory().create(1, Instant.now());
                assertCode(
                        () -> new RefreshTokenStore(redis).createForLogin(token, "runner01"),
                        "SERVICE_UNAVAILABLE");
                assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                        .isEqualTo(before);
                assertThat(redis.hasKey(RefreshTokenStore.familyKey(token.familyId()))).isFalse();
            }
        }
    }

    @Test
    void resetPermissionIsCheckedBeforeAnyGrantOrCounterMutation() throws Exception {
        try (var server = support.container()) {
            server.start();
            try (var admin = support.context(server, "default")) {
                var redis = admin.getBean(StringRedisTemplate.class);
                var attempts = new LoginAttemptStore(redis);
                attempts.recordFailure("runner01");
                String before = redis.opsForValue().get(LoginAttemptStore.key("runner01"));
                // Synthetic test account: permit everything in this isolated instance except DEL.
                assertThat(
                                server.execInContainer(
                                                "redis-cli",
                                                "--no-auth-warning",
                                                "-a",
                                                RefreshTokenStoreIntegrationTest.PASSWORD,
                                                "ACL",
                                                "SETUSER",
                                                "without_del",
                                                "on",
                                                ">" + RefreshTokenStoreIntegrationTest.PASSWORD,
                                                "~runway:auth:*",
                                                "+@all",
                                                "-del")
                                        .getExitCode())
                        .isZero();
                try (var limited = support.context(server, "without_del")) {
                    var token = new RefreshTokenFactory().create(1, Instant.now());
                    assertCode(
                            () ->
                                    new RefreshTokenStore(
                                                    limited.getBean(StringRedisTemplate.class))
                                            .createForLogin(token, "runner01"),
                            "SERVICE_UNAVAILABLE");
                    assertThat(redis.hasKey(RefreshTokenStore.familyKey(token.familyId())))
                            .isFalse();
                    assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                            .isEqualTo(before);
                }
            }
        }
    }

    @Test
    void partialFamilyFailureDoesNotResetCounterOrActivateGrant() throws Exception {
        try (var server = support.container()) {
            server.start();
            try (var context = support.context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                new LoginAttemptStore(redis).recordFailure("runner01");
                String before = redis.opsForValue().get(LoginAttemptStore.key("runner01"));
                // A later command ACL failure is real: Lua does not roll back its earlier writes.
                assertThat(
                                server.execInContainer(
                                                "redis-cli",
                                                "--no-auth-warning",
                                                "-a",
                                                RefreshTokenStoreIntegrationTest.PASSWORD,
                                                "ACL",
                                                "SETUSER",
                                                "without_expire",
                                                "on",
                                                ">" + RefreshTokenStoreIntegrationTest.PASSWORD,
                                                "~runway:auth:*",
                                                "+@all",
                                                "-expireat")
                                        .getExitCode())
                        .isZero();
                try (var limited = support.context(server, "without_expire")) {
                    var token = new RefreshTokenFactory().create(1, Instant.now());
                    assertCode(
                            () ->
                                    new RefreshTokenStore(
                                                    limited.getBean(StringRedisTemplate.class))
                                            .createForLogin(token, "runner01"),
                            "SERVICE_UNAVAILABLE");
                    assertThat(
                                    redis.opsForHash()
                                            .get(
                                                    RefreshTokenStore.familyKey(token.familyId()),
                                                    "state"))
                            .isNotEqualTo("ACTIVE");
                    assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                            .isEqualTo(before);
                }
            }
        }
    }

    private AnnotationConfigApplicationContext proxyContext(RedisReplyProxy proxy) {
        var context = new AnnotationConfigApplicationContext();
        context.setEnvironment(
                new MockEnvironment()
                        .withProperty("runway.auth.redis.host", proxy.host())
                        .withProperty("runway.auth.redis.port", Integer.toString(proxy.port()))
                        .withProperty("runway.auth.redis.username", "default")
                        .withProperty(
                                "runway.auth.redis.password",
                                RefreshTokenStoreIntegrationTest.PASSWORD));
        context.register(AuthenticationRedisConfig.class);
        context.refresh();
        return context;
    }
}
