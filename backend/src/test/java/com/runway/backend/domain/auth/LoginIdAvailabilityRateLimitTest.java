package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.controller.ClientIpResolver;
import com.runway.backend.domain.auth.service.LoginIdAvailabilityLimiter;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Instant;
import java.util.concurrent.*;

class LoginIdAvailabilityRateLimitTest extends AuthIntegrationSupport {
    @Autowired LoginIdAvailabilityLimiter limiter;

    @Test
    void sixtyAllowedAndSixtyFirstRejectedRegardlessOfSubmittedIdOrForwardedHeader()
            throws Exception {
        for (int i = 0; i < 60; i++) {
            mvc.perform(
                            get("/api/v1/auth/login-id/availability")
                                    .param("loginId", "name" + i)
                                    .header("X-Forwarded-For", "198.51.100." + i))
                    .andExpect(status().isOk());
        }
        mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", "other01"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("TOO_MANY_REQUESTS"));
        String key = LoginIdAvailabilityLimiter.key("127.0.0.1");
        assertThat(redis.opsForZSet().size(key)).isEqualTo(60L);
        assertThat(redis.getExpire(key)).isBetween(1L, 61L);
        mvc.perform(
                        get("/api/v1/auth/login-id/availability")
                                .param("loginId", "other01")
                                .with(
                                        req -> {
                                            req.setRemoteAddr("198.51.100.200");
                                            return req;
                                        }))
                .andExpect(status().isOk());
    }

    @Test
    void invalidRequestsAlsoConsumeTheQuota() throws Exception {
        for (int i = 0; i < 60; i++)
            mvc.perform(get("/api/v1/auth/login-id/availability"))
                    .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", "valid01"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void expiredEntriesLeaveTheRollingWindowAndNewEntriesStillCount() {
        String ip = "198.51.100.10", key = LoginIdAvailabilityLimiter.key(ip);
        long now = Instant.now().toEpochMilli();
        for (int i = 0; i < 60; i++) redis.opsForZSet().add(key, "old" + i, now - 61000);
        limiter.check(ip);
        assertThat(redis.opsForZSet().size(key)).isEqualTo(1L);
        for (int i = 1; i < 60; i++) limiter.check(ip);
        assertThatThrownBy(() -> limiter.check(ip))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.code()).isEqualTo("TOO_MANY_REQUESTS"));
        assertThat(redis.opsForZSet().size(key)).isEqualTo(60L);
    }

    @Test
    void concurrentRequestsCannotExceedSixtyAcrossLimiterInstances() throws Exception {
        var another = new LoginIdAvailabilityLimiter(redis);
        try (var executor = Executors.newFixedThreadPool(12)) {
            var tasks = new java.util.ArrayList<Future<Boolean>>();
            for (int i = 0; i < 80; i++) {
                var current = i % 2 == 0 ? limiter : another;
                tasks.add(
                        executor.submit(
                                () -> {
                                    try {
                                        current.check("198.51.100.11");
                                        return true;
                                    } catch (ApiException e) {
                                        assertThat(e.code()).isEqualTo("TOO_MANY_REQUESTS");
                                        return false;
                                    }
                                }));
            }
            int allowed = 0;
            for (var task : tasks) if (task.get(10, TimeUnit.SECONDS)) allowed++;
            assertThat(allowed).isEqualTo(60);
        }
    }

    @Test
    void corruptOrUnavailableStoreNeverDisablesTheLimit() {
        String ip = "198.51.100.12";
        redis.opsForValue().set(LoginIdAvailabilityLimiter.key(ip), "wrong-type");
        assertThatThrownBy(() -> limiter.check(ip))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.code()).isEqualTo("SERVICE_UNAVAILABLE"));
        var unavailable = mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic"))
                .when(unavailable)
                .execute(
                        any(org.springframework.data.redis.core.script.RedisScript.class),
                        anyList(),
                        any(Object[].class));
        assertThatThrownBy(() -> new LoginIdAvailabilityLimiter(unavailable).check(ip))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void forwardedIpIsUsedOnlyForExplicitlyTrustedHops() {
        var req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.2");
        req.addHeader("X-Forwarded-For", "203.0.113.99,198.51.100.20,10.0.0.3");
        assertThat(new ClientIpResolver("").resolve(req)).isEqualTo("10.0.0.2");
        assertThat(new ClientIpResolver("10.0.0.0/24").resolve(req)).isEqualTo("198.51.100.20");
        var other = new MockHttpServletRequest();
        other.setRemoteAddr("198.51.100.20");
        other.addHeader("X-Forwarded-For", "1.2.3.4");
        assertThat(new ClientIpResolver("10.0.0.0/24").resolve(other)).isEqualTo("198.51.100.20");
        req.removeHeader("X-Forwarded-For");
        req.addHeader("X-Forwarded-For", "attacker.example");
        assertThatThrownBy(() -> new ClientIpResolver("10.0.0.0/24").resolve(req))
                .isInstanceOf(ApiException.class);
    }
}
