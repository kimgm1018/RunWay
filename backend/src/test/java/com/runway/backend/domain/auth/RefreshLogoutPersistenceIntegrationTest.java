package com.runway.backend.domain.auth;

import static com.runway.backend.domain.auth.LoginAttemptStoreIntegrationTest.assertCode;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.*;

import java.time.Instant;

class RefreshLogoutPersistenceIntegrationTest {
    final RefreshTokenStoreIntegrationTest support = new RefreshTokenStoreIntegrationTest();

    @Test
    void neverResurrectsConsumedOrRevokedTokens() throws Exception {
        try (var server = support.container()) {
            server.start();
            var factory = new RefreshTokenFactory();
            var old = factory.create(1, Instant.now());
            var next = factory.rotate(1, old.familyId(), old.createdAt(), old.expiresAt());
            var loggedOut = factory.create(1, Instant.now());
            try (var context = support.context(server, "default")) {
                var store = new RefreshTokenStore(context.getBean(StringRedisTemplate.class));
                store.create(old);
                store.create(loggedOut);
                store.rotate(RefreshTokenFactory.parse(old.value()), next, Instant.now());
                store.logout(RefreshTokenFactory.parse(loggedOut.value()));
            }
            for (boolean crash : new boolean[] {false, true}) {
                if (crash)
                    server.getDockerClient()
                            .killContainerCmd(server.getContainerId())
                            .withSignal("KILL")
                            .exec();
                else server.getDockerClient().stopContainerCmd(server.getContainerId()).exec();
                server.getDockerClient().startContainerCmd(server.getContainerId()).exec();
                ready(server);
                try (var context = support.context(server, "default")) {
                    var redis = context.getBean(StringRedisTemplate.class);
                    assertThat(
                                    redis.opsForHash()
                                            .get(
                                                    RefreshTokenStore.familyKey(old.familyId()),
                                                    "used:" + old.hash()))
                            .isEqualTo("1");
                    assertThat(
                                    redis.opsForHash()
                                            .get(
                                                    RefreshTokenStore.familyKey(old.familyId()),
                                                    "currentTokenHash"))
                            .isEqualTo(next.hash());
                    assertThat(
                                    redis.opsForHash()
                                            .get(
                                                    RefreshTokenStore.familyKey(
                                                            loggedOut.familyId()),
                                                    "state"))
                            .isEqualTo("REVOKED");
                    assertThat(redis.getExpire(RefreshTokenStore.familyKey(old.familyId())))
                            .isBetween(2591800L, 2592000L);
                }
            }
            try (var context = support.context(server, "default")) {
                var store = new RefreshTokenStore(context.getBean(StringRedisTemplate.class));
                var third = factory.rotate(1, old.familyId(), old.createdAt(), old.expiresAt());
                assertCode(
                        () ->
                                store.rotate(
                                        RefreshTokenFactory.parse(old.value()),
                                        third,
                                        Instant.now()),
                        "INVALID_REFRESH_TOKEN");
                assertCode(
                        () -> store.find(RefreshTokenFactory.parse(next.value())),
                        "INVALID_REFRESH_TOKEN");
                assertCode(
                        () -> store.find(RefreshTokenFactory.parse(loggedOut.value())),
                        "INVALID_REFRESH_TOKEN");
            }
        }
        // Separate fresh isolated instance models operator-approved empty-store recovery.
        try (var empty = support.container()) {
            empty.start();
            try (var context = support.context(empty, "default")) {
                var store = new RefreshTokenStore(context.getBean(StringRedisTemplate.class));
                var unknown = new RefreshTokenFactory().create(1, Instant.now());
                assertCode(
                        () -> store.find(RefreshTokenFactory.parse(unknown.value())),
                        "INVALID_REFRESH_TOKEN");
                store.logout(RefreshTokenFactory.parse(unknown.value()));
            }
        }
    }

    @Test
    void productionEntryPointAclAllowsReadRotateAndLogout() {
        try (var server =
                new GenericContainer<>(
                                DockerImageName.parse(RefreshTokenStoreIntegrationTest.IMAGE))
                        .withExposedPorts(6379)
                        .withEnv("BACKEND_REDIS_USERNAME", "runway_app")
                        .withEnv(
                                "BACKEND_REDIS_PASSWORD", RefreshTokenStoreIntegrationTest.PASSWORD)
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
            try (var context = support.context(server, "runway_app")) {
                var store = new RefreshTokenStore(context.getBean(StringRedisTemplate.class));
                var factory = new RefreshTokenFactory();
                var old = factory.create(1, Instant.now());
                var next = factory.rotate(1, old.familyId(), old.createdAt(), old.expiresAt());
                store.create(old);
                assertThat(store.find(RefreshTokenFactory.parse(old.value())).userId())
                        .isEqualTo(1);
                store.rotate(RefreshTokenFactory.parse(old.value()), next, Instant.now());
                store.logout(RefreshTokenFactory.parse(old.value()));
                assertCode(
                        () -> store.find(RefreshTokenFactory.parse(next.value())),
                        "INVALID_REFRESH_TOKEN");
            }
        }
    }

    void ready(GenericContainer<?> server) throws Exception {
        for (int i = 0; i < 100; i++) {
            try {
                var result =
                        server.execInContainer(
                                "redis-cli",
                                "--no-auth-warning",
                                "-a",
                                RefreshTokenStoreIntegrationTest.PASSWORD,
                                "PING");
                if (result.getExitCode() == 0 && result.getStdout().contains("PONG")) return;
            } catch (Exception ignored) {
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Isolated Redis did not restart");
    }
}
