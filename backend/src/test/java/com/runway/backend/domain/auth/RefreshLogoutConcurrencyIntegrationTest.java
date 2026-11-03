package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.service.RefreshTokenFactory;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.concurrent.*;

class RefreshLogoutConcurrencyIntegrationTest extends RefreshIntegrationSupport {
    @Test
    void serializesBothOrders() throws Exception {
        var first = grant();
        logout.logout(first.value());
        invalid(first.value());
        var second = grant();
        var next = refresh.refresh(second.value());
        logout.logout(second.value());
        invalid(next.refreshToken());
        // Actual overlapping Redis operations, without serializing via the user's DB lock.
        for (int i = 0; i < 10; i++) {
            var token = grant();
            var replacement =
                    factory.rotate(user, token.familyId(), token.createdAt(), token.expiresAt());
            var barrier = new CyclicBarrier(2);
            try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
                var rotation =
                        pool.submit(
                                () -> {
                                    barrier.await(5, TimeUnit.SECONDS);
                                    try {
                                        store.rotate(
                                                RefreshTokenFactory.parse(token.value()),
                                                replacement,
                                                Instant.now());
                                    } catch (ApiException e) {
                                        assertThat(e.code()).isEqualTo("INVALID_REFRESH_TOKEN");
                                    }
                                    return null;
                                });
                var revocation =
                        pool.submit(
                                () -> {
                                    barrier.await(5, TimeUnit.SECONDS);
                                    logout.logout(token.value());
                                    return null;
                                });
                rotation.get(10, TimeUnit.SECONDS);
                revocation.get(10, TimeUnit.SECONDS);
            }
            assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
            invalid(replacement.value());
        }
    }
}
