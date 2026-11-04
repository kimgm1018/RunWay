package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.service.RefreshTokenFactory;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.concurrent.*;

class RefreshConcurrencyIntegrationTest extends RefreshIntegrationSupport {
    @Test
    void consumesOnceThenRevokesOnReuse() throws Exception {
        var old = grant();
        var a = factory.rotate(user, old.familyId(), old.createdAt(), old.expiresAt());
        var b = factory.rotate(user, old.familyId(), old.createdAt(), old.expiresAt());
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> consume(barrier, old.value(), a));
            var second = pool.submit(() -> consume(barrier, old.value(), b));
            assertThat(
                            java.util.List.of(
                                    first.get(10, TimeUnit.SECONDS),
                                    second.get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 401);
        }
        assertThat(redis.opsForHash().get(key(old), "state")).isEqualTo("REVOKED");
        invalid(a.value());
        invalid(b.value());
    }

    int consume(CyclicBarrier barrier, String old, RefreshTokenFactory.IssuedRefreshToken next)
            throws Exception {
        barrier.await(5, TimeUnit.SECONDS);
        try {
            store.rotate(RefreshTokenFactory.parse(old), next, Instant.now());
            return 200;
        } catch (ApiException failure) {
            assertThat(failure.code()).isEqualTo("INVALID_REFRESH_TOKEN");
            return failure.status().value();
        }
    }
}
