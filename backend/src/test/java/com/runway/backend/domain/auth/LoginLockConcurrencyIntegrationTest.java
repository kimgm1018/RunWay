package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.auth.repository.LoginAttemptStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.LoginService;
import com.runway.backend.domain.auth.service.MemberPasswordHasher;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

class LoginLockConcurrencyIntegrationTest extends AuthIntegrationSupport {
    @Autowired LoginService login;
    @Autowired LoginAttemptStore attempts;
    @MockitoSpyBean MemberPasswordHasher hasher;
    @MockitoSpyBean RefreshTokenStore store;

    @Test
    void failureWinningAfterPasswordVerificationPreventsIssuance() throws Exception {
        for (int initial : new int[] {1, 4}) {
            redis.delete(LoginAttemptStore.key("runner01"));
            for (int i = 0; i < initial; i++) attempts.recordFailure("runner01");
            var verified = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            doAnswer(
                            call -> {
                                boolean matched = (boolean) call.callRealMethod();
                                verified.countDown();
                                assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                                return matched;
                            })
                    .when(hasher)
                    .matches(anyString(), anyString());
            try (var executor = Executors.newSingleThreadExecutor()) {
                var signingIn = executor.submit(() -> login.login("runner01", "Runner9!"));
                try {
                    assertThat(verified.await(10, TimeUnit.SECONDS)).isTrue();
                    assertThat(attempts.recordFailure("runner01")).isEqualTo(initial + 1);
                } finally {
                    release.countDown();
                }
                if (initial == 4) {
                    assertThatThrownBy(() -> signingIn.get(10, TimeUnit.SECONDS))
                            .satisfies(
                                    error ->
                                            assertThat(error.getCause())
                                                    .isInstanceOfSatisfying(
                                                            com.runway.backend.global.exception
                                                                    .ApiException.class,
                                                            api -> {
                                                                assertThat(api.code())
                                                                        .isEqualTo("LOGIN_LOCKED");
                                                                assertThat(api.status().value())
                                                                        .isEqualTo(429);
                                                            }));
                    assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                            .startsWith("5:");
                    // The first iteration succeeded, but the locked iteration must add no family.
                    assertThat(redis.keys("runway:auth:family:*")).hasSize(1);
                } else {
                    assertThat(signingIn.get(10, TimeUnit.SECONDS).accessToken()).isNotBlank();
                    assertThat(redis.hasKey(LoginAttemptStore.key("runner01"))).isFalse();
                }
            }
        }
    }

    @Test
    void failureAfterAtomicActivationSurvivesTheSuccessfulResponse() throws Exception {
        for (int initial : new int[] {1, 4}) {
            redis.delete(LoginAttemptStore.key("runner01"));
            for (int i = 0; i < initial; i++) attempts.recordFailure("runner01");
            var activated = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            doAnswer(
                            call -> {
                                call.callRealMethod();
                                activated.countDown();
                                assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                                return null;
                            })
                    .when(store)
                    .createForLogin(any(), anyString());
            try (var executor = Executors.newSingleThreadExecutor()) {
                var signingIn = executor.submit(() -> login.login("runner01", "Runner9!"));
                try {
                    assertThat(activated.await(10, TimeUnit.SECONDS)).isTrue();
                    assertThat(attempts.recordFailure("runner01")).isEqualTo(1);
                } finally {
                    release.countDown();
                }
                assertThat(signingIn.get(10, TimeUnit.SECONDS).accessToken()).isNotBlank();
                assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                        .startsWith("1:");
            }
        }
    }

    @Test
    void simultaneousFailuresAtFourBothReturnLockedWithoutExtendingDeadline() throws Exception {
        for (int i = 0; i < 4; i++) attempts.recordFailure("runner01");
        var computed = new CountDownLatch(2);
        var release = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            boolean matched = (boolean) call.callRealMethod();
                            computed.countDown();
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            return matched;
                        })
                .when(hasher)
                .matches(anyString(), anyString());
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> login.login("runner01", "Wrong999!"));
            var second = executor.submit(() -> login.login("runner01", "Wrong999!"));
            try {
                assertThat(computed.await(10, TimeUnit.SECONDS)).isTrue();
            } finally {
                release.countDown();
            }
            for (var request : java.util.List.of(first, second)) {
                assertThatThrownBy(() -> request.get(10, TimeUnit.SECONDS))
                        .satisfies(
                                error ->
                                        assertThat(error.getCause())
                                                .isInstanceOfSatisfying(
                                                        com.runway.backend.global.exception
                                                                .ApiException.class,
                                                        api ->
                                                                assertThat(api.code())
                                                                        .isEqualTo(
                                                                                "LOGIN_LOCKED")));
            }
            String locked = redis.opsForValue().get(LoginAttemptStore.key("runner01"));
            assertThat(attempts.recordFailure("runner01")).isEqualTo(5);
            assertThat(redis.opsForValue().get(LoginAttemptStore.key("runner01")))
                    .isEqualTo(locked);
            assertThat(redis.keys("runway:auth:family:*")).isEmpty();
        }
    }
}
