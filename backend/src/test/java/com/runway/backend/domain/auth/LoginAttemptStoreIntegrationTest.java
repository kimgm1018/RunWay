package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.repository.LoginAttemptStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

class LoginAttemptStoreIntegrationTest extends AuthIntegrationSupport {
    @Autowired LoginAttemptStore attempts;
    @Autowired RefreshTokenStore store;

    @Test
    void eachFailureRefreshesOnlyTheTwentyFourHourRecord() {
        String key = LoginAttemptStore.key("runner01");
        seed(2, now() + 1000000);
        assertThat(attempts.recordFailure("runner01")).isEqualTo(3);
        String value = redis.opsForValue().get(key);
        long remaining = redis.getExpire(key, TimeUnit.MILLISECONDS);
        assertThat(remaining).isBetween(86390000L, 86400000L);
        attempts.ensureAllowed("runner01");
        assertThat(redis.opsForValue().get(key)).isEqualTo(value);
        assertThat(redis.getExpire(key, TimeUnit.MILLISECONDS)).isLessThanOrEqualTo(remaining);
    }

    @Test
    void deadlineInStateIsEnforcedEvenBeforePhysicalKeyCleanup() {
        // Keep the physical test key alive to exercise the production >= boundary explicitly.
        for (int count : new int[] {4, 5}) {
            seed(count, now() - 1);
            attempts.ensureAllowed("runner01");
            assertThat(attempts.recordFailure("runner01")).isEqualTo(1);
            assertThat(redis.getExpire(LoginAttemptStore.key("runner01")))
                    .isBetween(86390L, 86400L);
        }
        seed(5, now() + 30000);
        assertCode(() -> attempts.ensureAllowed("runner01"), "LOGIN_LOCKED");
        assertThat(attempts.recordFailure("runner01")).isEqualTo(5);
        assertThat(redis.getExpire(LoginAttemptStore.key("runner01"))).isBetween(1L, 60L);
    }

    @Test
    void exactMillisecondBoundaryUsesGreaterThanOrEqualForBothDeadlines() throws Exception {
        String source =
                new ClassPathResource("auth/login-attempt.lua")
                        .getContentAsString(StandardCharsets.UTF_8);
        long boundary = now() + 20000;
        for (int count : new int[] {4, 5}) {
            seed(count, boundary);
            assertThat(atTime(source, boundary - 1)).isEqualTo(5);
            seed(count, boundary);
            assertThat(atTime(source, boundary)).isEqualTo(1);
            seed(count, boundary);
            assertThat(atTime(source, boundary + 1)).isEqualTo(1);
        }
    }

    private long atTime(String source, long millis) {
        // Execute the unchanged production Lua in real Redis, replacing only its TIME source.
        String clock =
                "local actual = redis\nlocal redis = {call=function(command, ...) "
                        + "if command == 'TIME' then return {'"
                        + millis / 1000
                        + "','"
                        + millis % 1000 * 1000
                        + "'} end return actual.call(command, ...) end}\n";
        return redis.execute(
                new DefaultRedisScript<>(clock + source, Long.class),
                List.of(LoginAttemptStore.key("runner01")),
                "fail");
    }

    @Test
    void expiredRecordAllowsAtomicIssuanceButLockedRecordDoesNot() {
        var factory = new RefreshTokenFactory();
        var blocked = factory.create(user, Instant.now());
        seed(5, now() + 60000);
        String value = redis.opsForValue().get(LoginAttemptStore.key("runner01"));
        assertCode(() -> store.createForLogin(blocked, "runner01"), "LOGIN_LOCKED");
        assertThat(redis.hasKey(RefreshTokenStore.familyKey(blocked.familyId()))).isFalse();
        assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01"))).isEqualTo(value);
        seed(5, now() - 1);
        var allowed = factory.create(user, Instant.now());
        store.createForLogin(allowed, "runner01");
        assertThat(redis.opsForHash().get(RefreshTokenStore.familyKey(allowed.familyId()), "state"))
                .isEqualTo("ACTIVE");
        assertThat(redis.hasKey(LoginAttemptStore.key("runner01"))).isFalse();
    }

    @Test
    void invalidStateIsUnavailableAndNeverOverwritten() {
        String key = LoginAttemptStore.key("runner01");
        for (String value : List.of("bad", "0:1", "6:1", "5:999999999999999")) {
            redis.opsForValue().set(key, value, Duration.ofMinutes(1));
            assertCode(() -> attempts.ensureAllowed("runner01"), "SERVICE_UNAVAILABLE");
            assertCode(() -> attempts.recordFailure("runner01"), "SERVICE_UNAVAILABLE");
            assertCode(
                    () ->
                            store.createForLogin(
                                    new RefreshTokenFactory().create(user, Instant.now()),
                                    "runner01"),
                    "SERVICE_UNAVAILABLE");
            assertThat(redis.opsForValue().get(key)).isEqualTo(value);
        }
        redis.opsForValue().set(key, "1:" + (now() + 60000));
        assertThat(redis.getExpire(key)).isEqualTo(-1L);
        assertCode(() -> attempts.ensureAllowed("runner01"), "SERVICE_UNAVAILABLE");
        assertCode(() -> attempts.recordFailure("runner01"), "SERVICE_UNAVAILABLE");
        assertCode(
                () ->
                        store.createForLogin(
                                new RefreshTokenFactory().create(user, Instant.now()), "runner01"),
                "SERVICE_UNAVAILABLE");
        redis.delete(key);
        redis.opsForHash().put(key, "wrong", "type");
        assertCode(() -> attempts.recordFailure("runner01"), "SERVICE_UNAVAILABLE");
        assertThat(redis.opsForHash().get(key, "wrong")).isEqualTo("type");
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
    }

    @Test
    void concurrentInitialFailuresAndThresholdCrossingAreAtomic() throws Exception {
        var barrier = new CyclicBarrier(8);
        try (var executor = Executors.newFixedThreadPool(8)) {
            var tasks = new ArrayList<java.util.concurrent.Future<Integer>>();
            for (int i = 0; i < 8; i++)
                tasks.add(
                        executor.submit(
                                () -> {
                                    barrier.await(10, TimeUnit.SECONDS);
                                    return attempts.recordFailure("missing1");
                                }));
            var counts = new ArrayList<Integer>();
            for (var task : tasks) counts.add(task.get(10, TimeUnit.SECONDS));
            assertThat(counts).containsExactlyInAnyOrder(1, 2, 3, 4, 5, 5, 5, 5);
        }
        String key = LoginAttemptStore.key("missing1");
        String locked = redis.opsForValue().get(key);
        assertThat(attempts.recordFailure("missing1")).isEqualTo(5);
        assertThat(redis.opsForValue().get(key)).isEqualTo(locked);
    }

    @Test
    void concurrentFailuresAfterExpirationDoNotLoseTheNewSequence() throws Exception {
        seed(5, now() - 1);
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first =
                    executor.submit(
                            () -> {
                                barrier.await(10, TimeUnit.SECONDS);
                                return attempts.recordFailure("runner01");
                            });
            var second =
                    executor.submit(
                            () -> {
                                barrier.await(10, TimeUnit.SECONDS);
                                return attempts.recordFailure("runner01");
                            });
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(1, 2);
            assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01"))).startsWith("2:");
        }
    }

    private long now() {
        return redis.execute(
                new DefaultRedisScript<>(
                        "local t=redis.call('TIME'); return"
                                + " tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)",
                        Long.class),
                List.of());
    }

    private void seed(int count, long deadline) {
        redis.opsForValue()
                .set(
                        LoginAttemptStore.key("runner01"),
                        count + ":" + deadline,
                        Duration.ofMinutes(1));
    }

    static void assertCode(
            org.assertj.core.api.ThrowableAssert.ThrowingCallable action, String code) {
        assertThatThrownBy(action)
                .isInstanceOfSatisfying(
                        ApiException.class, failure -> assertThat(failure.code()).isEqualTo(code));
    }
}
