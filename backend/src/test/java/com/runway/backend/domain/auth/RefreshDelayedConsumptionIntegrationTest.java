package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

class RefreshDelayedConsumptionIntegrationTest extends RefreshIntegrationSupport {
    @Autowired RefreshTokenStore spiedStore;

    @Test
    void realRedisRejectsDelayedConsumptionAndExpiresUsedHistory() throws Exception {
        Instant cap =
                Instant.ofEpochSecond(
                        Math.max(Instant.now().getEpochSecond(), redisMillis() / 1000) + 5);
        var source = shortGrant(cap);
        var active = refresh.refresh(source.value());
        var delayed = shortGrant(cap);
        assertThat(redis.opsForHash().get(key(source), "used:" + source.hash())).isEqualTo("1");
        var attempted = new java.util.concurrent.atomic.AtomicBoolean();
        doAnswer(
                        call -> {
                            // JWT has already been issued. Keep the original application timestamp,
                            // but delay
                            // the actual Redis command until Redis TIME must reject the remaining
                            // subsecond.
                            var next = (IssuedRefreshToken) call.getArgument(1);
                            assertThat(next.expiresAt()).isEqualTo(cap);
                            while (redisMillis() < cap.toEpochMilli() - 800) Thread.sleep(10);
                            attempted.set(true);
                            return call.callRealMethod();
                        })
                .when(spiedStore)
                .rotate(any(), any(), any());
        request("refresh", delayed.value())
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_REFRESH_TOKEN"))
                .andExpect(jsonPath("$.accessToken").doesNotExist());
        assertThat(attempted.get()).isTrue();
        assertThat(redis.opsForHash().get(key(delayed), "currentTokenHash"))
                .isEqualTo(delayed.hash());
        assertThat(redis.opsForHash().hasKey(key(delayed), "used:" + delayed.hash())).isFalse();
        while (redisMillis() <= cap.toEpochMilli()) Thread.sleep(10);
        assertThat(redis.hasKey(key(source))).isFalse();
        assertThat(redis.hasKey(key(delayed))).isFalse();
        invalid(active.refreshToken());
    }

    long redisMillis() {
        return redis.execute(
                (org.springframework.data.redis.core.RedisCallback<Long>)
                        connection -> connection.serverCommands().time());
    }

    IssuedRefreshToken shortGrant(Instant expires) {
        var token = factory.create(user, Instant.now().minusSeconds(30));
        var shortToken =
                new IssuedRefreshToken(
                        user,
                        token.familyId(),
                        token.value(),
                        token.hash(),
                        token.createdAt(),
                        expires);
        store.create(shortToken);
        return shortToken;
    }
}
