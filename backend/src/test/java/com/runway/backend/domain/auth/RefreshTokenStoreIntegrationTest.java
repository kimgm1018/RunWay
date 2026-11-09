package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.config.AuthenticationRedisConfig;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.mock.env.MockEnvironment;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.time.Instant;
import java.util.concurrent.TimeUnit;

class RefreshTokenStoreIntegrationTest {
    static final String IMAGE =
            "redis:8.2.11@sha256:dae6b6fcd9e26c1e73cf70323f0711d4c1ade5bf40c1dfd9aa24d0fbb57e2309";
    static final String PASSWORD = "synthetic-redis-only";

    GenericContainer<?> container() {
        return new GenericContainer<>(DockerImageName.parse(IMAGE))
                .withExposedPorts(6379)
                .withCommand(
                        "redis-server",
                        "--appendonly",
                        "yes",
                        "--appendfsync",
                        "always",
                        "--aof-load-truncated",
                        "no",
                        "--maxmemory-policy",
                        "noeviction",
                        "--save",
                        "",
                        "--requirepass",
                        PASSWORD);
    }

    AnnotationConfigApplicationContext context(GenericContainer<?> server, String username) {
        var context = new AnnotationConfigApplicationContext();
        context.setEnvironment(
                new MockEnvironment()
                        .withProperty("runway.auth.redis.host", server.getHost())
                        .withProperty("runway.auth.redis.port", currentPort(server))
                        .withProperty("runway.auth.redis.username", username)
                        .withProperty("runway.auth.redis.password", PASSWORD));
        context.register(AuthenticationRedisConfig.class);
        context.refresh();
        return context;
    }

    @Test
    void expiryAndRecovery() throws Exception {
        try (var server = container()) {
            server.start();
            try (var context = context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var factory = new RefreshTokenFactory();
                Instant cap = Instant.ofEpochSecond(Instant.now().getEpochSecond() + 20);
                var active = shortFamily(factory.create(1, Instant.now()), cap);
                var revoked = shortFamily(factory.create(1, Instant.now()), cap);
                store.create(active);
                store.create(revoked);
                assertThat(store.revokeUndelivered(revoked)).isTrue();
                for (boolean crash : new boolean[] {false, true}) {
                    if (crash)
                        server.getDockerClient()
                                .killContainerCmd(server.getContainerId())
                                .withSignal("KILL")
                                .exec();
                    else server.getDockerClient().stopContainerCmd(server.getContainerId()).exec();
                    server.getDockerClient().startContainerCmd(server.getContainerId()).exec();
                    ready(server);
                    reconnectAfterRestart(context, server);
                    assertRestored(redis, active, "ACTIVE");
                    assertRestored(redis, revoked, "REVOKED");
                    assertThat(redis.opsForZSet().range(RefreshTokenStore.userKey(1), 0, -1))
                            .containsExactlyInAnyOrder(active.familyId(), revoked.familyId());
                    assertThat(
                                    redis.opsForZSet()
                                            .score(RefreshTokenStore.userKey(1), active.familyId()))
                            .isEqualTo((double) cap.getEpochSecond());
                }
                while (Instant.now().getEpochSecond() <= cap.getEpochSecond())
                    TimeUnit.MILLISECONDS.sleep(100);
                assertThat(redis.hasKey(RefreshTokenStore.familyKey(active.familyId()))).isFalse();
                assertThat(redis.hasKey(RefreshTokenStore.familyKey(revoked.familyId()))).isFalse();
                assertThat(redis.hasKey(RefreshTokenStore.userKey(1))).isFalse();
                assertThatThrownBy(() -> store.create(active)).isInstanceOf(ApiException.class);
            }
        }
    }

    private IssuedRefreshToken shortFamily(IssuedRefreshToken original, Instant expires) {
        return new IssuedRefreshToken(
                original.userId(),
                original.familyId(),
                original.value(),
                original.hash(),
                original.createdAt(),
                expires);
    }

    @Test
    void withdrawalRevokesEveryIndexedFamilyAndKeepsOtherUsersAndDeadlines() {
        try (var server = container()) {
            server.start();
            try (var context = context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var factory = new RefreshTokenFactory();
                var first = factory.create(1, Instant.now());
                var second = factory.create(1, Instant.now());
                var other = factory.create(2, Instant.now());
                store.create(first);
                store.create(second);
                store.create(other);
                var presented = RefreshTokenFactory.parse(first.value());
                var rotated = factory.rotate(1, first.familyId(), first.createdAt(), first.expiresAt());
                store.rotate(presented, rotated, Instant.now());
                // A stale index member whose family has expired must not block withdrawal.
                var expired = factory.create(1, Instant.now());
                redis.opsForZSet().add(RefreshTokenStore.userKey(1), expired.familyId(), 1);

                store.revokeAll(1);
                store.revokeAll(1);
                store.revokeAll(3); // No logins is also idempotent success.

                assertRestored(redis, rotated, "REVOKED");
                assertThat(redis.opsForHash().get(RefreshTokenStore.familyKey(first.familyId()),
                        "currentTokenHash")).isEqualTo(rotated.hash());
                assertRestored(redis, second, "REVOKED");
                assertRestored(redis, other, "ACTIVE");
                assertThatThrownBy(() -> store.find(presented)).isInstanceOf(ApiException.class);
                assertThatThrownBy(() -> store.find(RefreshTokenFactory.parse(rotated.value())))
                        .isInstanceOf(ApiException.class);
                assertThatThrownBy(() -> store.find(RefreshTokenFactory.parse(second.value())))
                        .isInstanceOf(ApiException.class);
                assertThat(store.find(RefreshTokenFactory.parse(other.value())).userId()).isEqualTo(2);
                assertThat(redis.opsForZSet().score(RefreshTokenStore.userKey(1), first.familyId()))
                        .isEqualTo((double) first.expiresAt().getEpochSecond());
            }
        }
    }

    @Test
    void malformedOrForeignFamilyStopsWithdrawalBeforeAnyRevocation() {
        try (var server = container()) {
            server.start();
            try (var context = context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var factory = new RefreshTokenFactory();
                var own = factory.create(1, Instant.now());
                var foreign = factory.create(2, Instant.now());
                store.create(own);
                store.create(foreign);
                redis.opsForZSet().add(RefreshTokenStore.userKey(1), foreign.familyId(),
                        foreign.expiresAt().getEpochSecond());
                assertUnavailable(() -> store.revokeAll(1));
                assertRestored(redis, own, "ACTIVE");
                assertRestored(redis, foreign, "ACTIVE");
                redis.opsForZSet().remove(RefreshTokenStore.userKey(1), foreign.familyId());
                redis.opsForZSet().add(RefreshTokenStore.userKey(1), "malformed", 1);
                assertUnavailable(() -> store.revokeAll(1));
                assertRestored(redis, own, "ACTIVE");
                redis.opsForZSet().remove(RefreshTokenStore.userKey(1), "malformed");
                redis.opsForValue().set(RefreshTokenStore.familyKey(foreign.familyId()), "wrong-type");
                redis.opsForZSet().add(RefreshTokenStore.userKey(1), foreign.familyId(), 1);
                assertUnavailable(() -> store.revokeAll(1));
                assertRestored(redis, own, "ACTIVE");
            }
        }
    }

    private void assertUnavailable(Runnable operation) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.code()).isEqualTo("SERVICE_UNAVAILABLE"));
    }

    @Test
    void changedOrExpiredCandidateIndexIsRecheckedBeforeRevocation() {
        try (var server = container()) {
            server.start();
            try (var context = context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var factory = new RefreshTokenFactory();
                var token = factory.create(1, Instant.now());
                store.create(token);
                var candidateKeys = java.util.List.of(RefreshTokenStore.userKey(1),
                        RefreshTokenStore.familyKey(token.familyId()));
                var script = new DefaultRedisScript<Long>();
                script.setLocation(new ClassPathResource("auth/revoke-user-families.lua"));
                script.setResultType(Long.class);
                var extra = factory.create(1, Instant.now());
                redis.opsForZSet().add(RefreshTokenStore.userKey(1), extra.familyId(),
                        extra.expiresAt().getEpochSecond());
                assertThat(redis.execute(script, candidateKeys, "1")).isEqualTo(-1L);
                assertRestored(redis, token, "ACTIVE");

                // Model index expiry/loss after candidate read, with a live grant remaining.
                redis.delete(RefreshTokenStore.userKey(1));
                assertThat(redis.execute(script, candidateKeys, "1")).isEqualTo(-1L);
                assertRestored(redis, token, "ACTIVE");
                // If both the index and all candidate families expired, retry is harmless.
                redis.delete(RefreshTokenStore.familyKey(token.familyId()));
                assertThat(redis.execute(script, candidateKeys, "1")).isEqualTo(1L);
            }
        }
    }

    private void assertRestored(StringRedisTemplate redis, IssuedRefreshToken token, String state) {
        String key = RefreshTokenStore.familyKey(token.familyId());
        assertThat(redis.opsForHash().get(key, "state")).isEqualTo(state);
        assertThat(redis.opsForHash().get(key, "currentTokenHash")).isEqualTo(token.hash());
        assertThat(redis.opsForHash().get(key, "createdAt"))
                .isEqualTo(Long.toString(token.createdAt().getEpochSecond()));
        assertThat(redis.opsForHash().get(key, "expiresAt"))
                .isEqualTo(Long.toString(token.expiresAt().getEpochSecond()));
        long remaining = token.expiresAt().getEpochSecond() - Instant.now().getEpochSecond();
        assertThat(remaining).isPositive();
        assertThat(redis.getExpire(key)).isBetween(remaining - 1, remaining + 1);
    }

    @Test
    void wrongTypeAndMemoryPressureNeverEvictExistingGrants() {
        try (var server = container()) {
            server.start();
            try (var context = context(server, "default")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var factory = new RefreshTokenFactory();
                var wrong = factory.create(2, Instant.now());
                redis.opsForValue().set(RefreshTokenStore.userKey(2), "wrong-type");
                assertThatThrownBy(() -> store.create(wrong)).isInstanceOf(ApiException.class);
                assertThat(redis.hasKey(RefreshTokenStore.familyKey(wrong.familyId()))).isFalse();
                var existing = factory.create(1, Instant.now());
                store.create(existing);
                try (var connection = redis.getConnectionFactory().getConnection()) {
                    connection.serverCommands().setConfig("maxmemory", "1");
                }
                assertThatThrownBy(() -> store.create(factory.create(1, Instant.now())))
                        .isInstanceOf(ApiException.class);
                assertThat(
                                redis.opsForHash()
                                        .get(
                                                RefreshTokenStore.familyKey(existing.familyId()),
                                                "state"))
                        .isEqualTo("ACTIVE");
            }
        }
    }

    @Test
    void damagedAofRefusesStartupAndFreshStoreHasNoOldGrant() throws Exception {
        var token = new RefreshTokenFactory().create(1, Instant.now());
        try (var server = container()) {
            server.start();
            try (var context = context(server, "default")) {
                new RefreshTokenStore(context.getBean(StringRedisTemplate.class)).create(token);
            }
            // This is the disposable container's own AOF, never a project or shared volume.
            server.getDockerClient().stopContainerCmd(server.getContainerId()).exec();
            // A tiny helper in the same isolated volume is not required: Docker archive copy is
            // used to append malformed bytes after restarting, then the process is killed.
            server.getDockerClient().startContainerCmd(server.getContainerId()).exec();
            ready(server);
            var corrupted =
                    server.execInContainer(
                            "sh",
                            "-c",
                            "for f in /data/appendonlydir/*.incr.aof; do printf '*3\\r"
                                    + "\\n"
                                    + "$3\\r"
                                    + "\\n"
                                    + "SET\\r"
                                    + "\\n"
                                    + "' >> \"$f\"; done");
            assertThat(corrupted.getExitCode()).isZero();
            server.getDockerClient()
                    .killContainerCmd(server.getContainerId())
                    .withSignal("KILL")
                    .exec();
            server.getDockerClient().startContainerCmd(server.getContainerId()).exec();
            for (int i = 0;
                    i < 30
                            && Boolean.TRUE.equals(
                                    server.getDockerClient()
                                            .inspectContainerCmd(server.getContainerId())
                                            .exec()
                                            .getState()
                                            .getRunning());
                    i++) TimeUnit.MILLISECONDS.sleep(100);
            assertThat(
                            server.getDockerClient()
                                    .inspectContainerCmd(server.getContainerId())
                                    .exec()
                                    .getState()
                                    .getRunning())
                    .isFalse();
        }
        try (var fresh = container()) {
            fresh.start();
            try (var context = context(fresh, "default")) {
                assertThat(
                                context.getBean(StringRedisTemplate.class)
                                        .hasKey(RefreshTokenStore.familyKey(token.familyId())))
                        .isFalse();
            }
        }
    }

    @Test
    void productionEntrypointAllowsOnlyAuthenticationCommands() throws Exception {
        try (var server =
                new GenericContainer<>(DockerImageName.parse(IMAGE))
                        .withExposedPorts(6379)
                        .withEnv("BACKEND_REDIS_USERNAME", "runway_app")
                        .withEnv("BACKEND_REDIS_PASSWORD", PASSWORD)
                        .withCopyFileToContainer(
                                MountableFile.forHostPath("redis/redis.conf"),
                                "/etc/runway/redis.conf")
                        .withCopyFileToContainer(
                                MountableFile.forHostPath("redis/entrypoint.sh"),
                                "/etc/runway/entrypoint.sh")
                        .withCreateContainerCmdModifier(
                                command ->
                                        command.withEntrypoint(
                                                "/bin/sh", "/etc/runway/entrypoint.sh"))) {
            server.start();
            try (var context = context(server, "runway_app")) {
                var redis = context.getBean(StringRedisTemplate.class);
                var store = new RefreshTokenStore(redis);
                var token = new RefreshTokenFactory().create(1, Instant.now());
                var attempts =
                        new com.runway.backend.domain.auth.repository.LoginAttemptStore(redis);
                assertThat(attempts.recordFailure("runner01")).isEqualTo(1);
                attempts.ensureAllowed("runner01");
                store.createForLogin(token, "runner01");
                var limiter =
                        new com.runway.backend.domain.auth.service.LoginIdAvailabilityLimiter(
                                redis);
                for (int request = 0; request < 60; request++) limiter.check("198.51.100.30");
                assertThatThrownBy(() -> limiter.check("198.51.100.30"))
                        .isInstanceOfSatisfying(
                                ApiException.class,
                                error -> assertThat(error.code()).isEqualTo("TOO_MANY_REQUESTS"));

                // S15P31E105-560: 휴대전화 인증 스크립트도 앱 ACL 명령·키 범위 안에서 동작한다.
                var phones =
                        new com.runway.backend.domain.auth.repository.PhoneVerificationStore(redis);
                var signUp =
                        com.runway.backend.domain.auth.verification.PhoneVerificationPurpose.SIGN_UP;
                String phone = "01012345678";
                String waitKey =
                        "runway:auth:phone:wait:SIGN_UP:"
                                + java.util.HexFormat.of()
                                        .formatHex(
                                                java.security.MessageDigest.getInstance("SHA-256")
                                                        .digest(
                                                                phone.getBytes(
                                                                        java.nio.charset
                                                                                .StandardCharsets
                                                                                .UTF_8)));
                assertThat(phones.issue(signUp, phone, "198.51.100.31", "123456").status())
                        .isEqualTo(1);
                assertThat(phones.issue(signUp, phone, "198.51.100.31", "123456").status())
                        .isEqualTo(-2);
                assertThat(phones.confirm(signUp, phone, "000000", "synthetic-proof").status())
                        .isEqualTo(-5);
                assertThat(phones.confirm(signUp, phone, "123456", "synthetic-proof").status())
                        .isEqualTo(1);
                phones.discard(signUp, phone, "123456");
                assertThat(phones.consume("synthetic-proof")).isPresent();
                assertThat(phones.consume("synthetic-proof")).isEmpty();
                for (int sent = 1; sent < 5; sent++) {
                    redis.delete(waitKey);
                    assertThat(phones.issue(signUp, phone, "198.51.100.31", "123456").status())
                            .isEqualTo(1);
                }
                redis.delete(waitKey);
                assertThat(phones.issue(signUp, phone, "198.51.100.31", "123456").status())
                        .isEqualTo(-3);

                assertThat(
                                redis.opsForValue()
                                        .get(
                                                com.runway.backend.domain.auth.repository
                                                        .LoginAttemptStore.key("runner01")))
                        .isNull();
                assertThat(
                                redis.opsForHash()
                                        .get(
                                                RefreshTokenStore.familyKey(token.familyId()),
                                                "state"))
                        .isEqualTo("ACTIVE");
                store.revokeAll(1);
                assertThat(store.revokeUndelivered(token)).isTrue();
                assertThatThrownBy(() -> redis.opsForValue().set("outside:auth:scope", "synthetic"))
                        .isInstanceOf(RuntimeException.class);
                assertThatThrownBy(
                                () -> {
                                    try (var connection =
                                            redis.getConnectionFactory().getConnection()) {
                                        connection.serverCommands().flushAll();
                                    }
                                })
                        .isInstanceOf(RuntimeException.class);
                assertThat(
                                redis.opsForHash()
                                        .get(
                                                RefreshTokenStore.familyKey(token.familyId()),
                                                "state"))
                        .isEqualTo("REVOKED");
            }
        }
    }

    private void reconnectAfterRestart(
            AnnotationConfigApplicationContext context, GenericContainer<?> server) {
        // Docker may assign a new published port after a process restart. Refresh the endpoint
        // explicitly; this test proves persistence across restarts, not transparent reconnection.
        var connections = context.getBean(LettuceConnectionFactory.class);
        connections.stop();
        connections.getStandaloneConfiguration().setPort(Integer.parseInt(currentPort(server)));
        connections.start();
    }

    private String currentPort(GenericContainer<?> server) {
        return server.getDockerClient()
                .inspectContainerCmd(server.getContainerId())
                .exec()
                .getNetworkSettings()
                .getPorts()
                .getBindings()
                .get(com.github.dockerjava.api.model.ExposedPort.tcp(6379))[0]
                .getHostPortSpec();
    }

    private void ready(GenericContainer<?> server) throws Exception {
        for (int i = 0; i < 50; i++) {
            try {
                if (server.execInContainer("redis-cli", "--no-auth-warning", "-a", PASSWORD, "ping")
                        .getStdout()
                        .contains("PONG")) return;
            } catch (Exception ignored) {
            }
            TimeUnit.MILLISECONDS.sleep(100);
        }
        throw new AssertionError("Disposable Redis did not restart");
    }
}
