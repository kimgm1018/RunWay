package com.runway.backend.domain.auth;

import static com.runway.backend.domain.auth.LoginAttemptStoreIntegrationTest.assertCode;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.config.AuthenticationRedisConfig;
import com.runway.backend.domain.auth.repository.*;
import com.runway.backend.domain.auth.service.*;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.*;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.mock.env.MockEnvironment;

import java.time.Instant;

class RefreshLogoutFailureIntegrationTest {
    final RefreshTokenStoreIntegrationTest support = new RefreshTokenStoreIntegrationTest();
    final RefreshTokenFactory factory = new RefreshTokenFactory();

    @Test
    void failsClosedOnStoreOrCommitFailure() throws Exception {
        try (var server = support.container()) {
            server.start();
            try (var context = support.context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var old = factory.create(1, Instant.now());
                store.create(old);
                var next = factory.rotate(1, old.familyId(), old.createdAt(), old.expiresAt());
                var script = new DefaultRedisScript<Long>();
                script.setLocation(new ClassPathResource("auth/rotate-refresh-token.lua"));
                script.setResultType(Long.class);
                // Warm script cache without consuming a real credential.
                assertCode(
                        () ->
                                store.rotate(
                                        RefreshTokenFactory.parse(old.value()),
                                        next,
                                        old.expiresAt()),
                        "INVALID_REFRESH_TOKEN");
                for (var fault :
                        new RedisReplyProxy.Fault[] {
                            RedisReplyProxy.Fault.DISCONNECT_BEFORE_WRITE,
                            RedisReplyProxy.Fault.LOSE_REPLY
                        }) {
                    var token = factory.create(1, Instant.now());
                    store.create(token);
                    var replacement =
                            factory.rotate(
                                    1, token.familyId(), token.createdAt(), token.expiresAt());
                    try (var proxy =
                                    new RedisReplyProxy(
                                            server.getHost(),
                                            server.getMappedPort(6379),
                                            script.getSha1());
                            var proxied = proxyContext(proxy)) {
                        var failing =
                                new RefreshTokenStore(proxied.getBean(StringRedisTemplate.class));
                        // Establish the client connection before arming the transport fault.
                        failing.find(RefreshTokenFactory.parse(token.value()));
                        proxy.arm(fault);
                        assertCode(
                                () ->
                                        failing.rotate(
                                                RefreshTokenFactory.parse(token.value()),
                                                replacement,
                                                Instant.now()),
                                "SERVICE_UNAVAILABLE");
                        assertThat(proxy.createRequests.get()).isEqualTo(1);
                        assertThat(
                                        redis.opsForHash()
                                                .get(
                                                        RefreshTokenStore.familyKey(
                                                                token.familyId()),
                                                        "currentTokenHash"))
                                .isEqualTo(
                                        fault == RedisReplyProxy.Fault.LOSE_REPLY
                                                ? replacement.hash()
                                                : token.hash());
                    }
                }
                // Wrong Redis type is a storage failure, not an unknown token.
                redis.delete(RefreshTokenStore.familyKey(old.familyId()));
                redis.opsForValue().set(RefreshTokenStore.familyKey(old.familyId()), "corrupt");
                assertCode(
                        () -> store.find(RefreshTokenFactory.parse(old.value())),
                        "SERVICE_UNAVAILABLE");
                assertCode(
                        () -> store.logout(RefreshTokenFactory.parse(old.value())),
                        "SERVICE_UNAVAILABLE");
            }
        }
    }

    @Test
    void memoryAndAclFailuresDoNotPartiallyRotate() throws Exception {
        try (var server = support.container()) {
            server.start();
            try (var context = support.context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var old = factory.create(1, Instant.now());
                store.create(old);
                var next = factory.rotate(1, old.familyId(), old.createdAt(), old.expiresAt());
                try (var connection = redis.getConnectionFactory().getConnection()) {
                    connection.serverCommands().setConfig("maxmemory", "1");
                }
                assertCode(
                        () ->
                                store.rotate(
                                        RefreshTokenFactory.parse(old.value()),
                                        next,
                                        Instant.now()),
                        "SERVICE_UNAVAILABLE");
                assertThat(
                                redis.opsForHash()
                                        .get(
                                                RefreshTokenStore.familyKey(old.familyId()),
                                                "currentTokenHash"))
                        .isEqualTo(old.hash());
                try (var connection = redis.getConnectionFactory().getConnection()) {
                    connection.serverCommands().setConfig("maxmemory", "0");
                }
                assertThat(
                                server.execInContainer(
                                                "redis-cli",
                                                "--no-auth-warning",
                                                "-a",
                                                RefreshTokenStoreIntegrationTest.PASSWORD,
                                                "ACL",
                                                "SETUSER",
                                                "without_hset",
                                                "on",
                                                ">" + RefreshTokenStoreIntegrationTest.PASSWORD,
                                                "~*",
                                                "+@all",
                                                "-hset")
                                        .getExitCode())
                        .isZero();
                try (var denied = support.context(server, "without_hset")) {
                    var blocked = new RefreshTokenStore(denied.getBean(StringRedisTemplate.class));
                    assertCode(
                            () ->
                                    blocked.rotate(
                                            RefreshTokenFactory.parse(old.value()),
                                            next,
                                            Instant.now()),
                            "SERVICE_UNAVAILABLE");
                    assertCode(
                            () -> blocked.logout(RefreshTokenFactory.parse(old.value())),
                            "SERVICE_UNAVAILABLE");
                }
                assertThat(
                                redis.opsForHash()
                                        .get(
                                                RefreshTokenStore.familyKey(old.familyId()),
                                                "currentTokenHash"))
                        .isEqualTo(old.hash());
                assertThat(
                                redis.opsForHash()
                                        .hasKey(
                                                RefreshTokenStore.familyKey(old.familyId()),
                                                "used:" + old.hash()))
                        .isFalse();
                assertThat(
                                redis.opsForHash()
                                        .get(RefreshTokenStore.familyKey(old.familyId()), "state"))
                        .isEqualTo("ACTIVE");
            }
        }
    }

    AnnotationConfigApplicationContext proxyContext(RedisReplyProxy proxy) {
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
