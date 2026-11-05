package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.LoginService;
import com.runway.backend.domain.auth.service.MemberPasswordHasher;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

class LoginAccountStateIntegrationTest extends AuthIntegrationSupport {
    @Autowired MemberPasswordHasher hasher;
    @Autowired RefreshTokenStore store;
    @Autowired LoginService login;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void withdrawalBeforeIssuanceRejectsVerifiedSnapshot() throws Exception {
        verifyChangedSnapshot(true);
    }

    @Test
    void passwordChangedBeforeIssuanceRejectsVerifiedSnapshot() throws Exception {
        verifyChangedSnapshot(false);
    }

    private void verifyChangedSnapshot(boolean withdraw) throws Exception {
        var verified = new CountDownLatch(1);
        var proceed = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            boolean matched = (Boolean) call.callRealMethod();
                            verified.countDown();
                            assertThat(proceed.await(10, TimeUnit.SECONDS)).isTrue();
                            return matched;
                        })
                .when(hasher)
                .matches(anyString(), anyString());
        try (var pool = Executors.newSingleThreadExecutor()) {
            var future = pool.submit(() -> login.login("runner01", "Runner9!"));
            try {
                assertThat(verified.await(10, TimeUnit.SECONDS)).isTrue();
                if (withdraw)
                    jdbc.update(
                            "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE"
                                + " id=?",
                            user);
                else
                    jdbc.update(
                            "UPDATE users SET password=? WHERE id=?", encoded + "changed", user);
            } finally {
                proceed.countDown();
            }
            assertThatThrownBy(() -> future.get(10, TimeUnit.SECONDS))
                    .hasCauseInstanceOf(ApiException.class);
            assertThat(redis.keys("runway:auth:family:*")).isEmpty();
        }
    }

    @Test
    void loginLockSerializesWithdrawalAndRevocation() throws Exception {
        var writing = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var withdrawalStarted = new CountDownLatch(1);
        var withdrawalLocked = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            writing.countDown();
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            return call.callRealMethod();
                        })
                .when(store)
                .createForLogin(org.mockito.ArgumentMatchers.any(), anyString());
        try (var pool = Executors.newFixedThreadPool(2)) {
            var signingIn = pool.submit(() -> login.login("runner01", "Runner9!"));
            assertThat(writing.await(10, TimeUnit.SECONDS)).isTrue();
            var withdrawal =
                    pool.submit(
                            () ->
                                    new TransactionTemplate(transactionManager)
                                            .execute(
                                                    status -> {
                                                        withdrawalStarted.countDown();
                                                        jdbc.queryForObject(
                                                                "SELECT id FROM users WHERE id=?"
                                                                    + " FOR UPDATE",
                                                                Long.class,
                                                                user);
                                                        withdrawalLocked.countDown();
                                                        jdbc.update(
                                                                "UPDATE users SET"
                                                                    + " account_status='WITHDRAWN',"
                                                                    + " withdrawn_at=now() WHERE"
                                                                    + " id=?",
                                                                user);
                                                        for (String family :
                                                                redis.opsForZSet()
                                                                        .range(
                                                                                RefreshTokenStore
                                                                                        .userKey(
                                                                                                user),
                                                                                0,
                                                                                -1))
                                                            redis.opsForHash()
                                                                    .put(
                                                                            RefreshTokenStore
                                                                                    .familyKey(
                                                                                            family),
                                                                            "state",
                                                                            "REVOKED");
                                                        return null;
                                                    }));
            try {
                assertThat(withdrawalStarted.await(10, TimeUnit.SECONDS)).isTrue();
                assertThat(withdrawalLocked.await(150, TimeUnit.MILLISECONDS)).isFalse();
            } finally {
                release.countDown();
            }
            var response = signingIn.get(10, TimeUnit.SECONDS);
            withdrawal.get(10, TimeUnit.SECONDS);
            assertThat(
                            redis.opsForHash()
                                    .get(
                                            RefreshTokenStore.familyKey(
                                                    response.refreshToken().split("\\.")[0]),
                                            "state"))
                    .isEqualTo("REVOKED");
        }
    }

    @Test
    void lockTimeoutIsUnavailable() throws Exception {
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try (var pool = Executors.newSingleThreadExecutor()) {
            var holder =
                    pool.submit(
                            () ->
                                    new TransactionTemplate(transactionManager)
                                            .execute(
                                                    status -> {
                                                        jdbc.queryForObject(
                                                                "SELECT id FROM users WHERE id=?"
                                                                    + " FOR UPDATE",
                                                                Long.class,
                                                                user);
                                                        locked.countDown();
                                                        try {
                                                            release.await(10, TimeUnit.SECONDS);
                                                        } catch (InterruptedException ex) {
                                                            Thread.currentThread().interrupt();
                                                        }
                                                        return null;
                                                    }));
            try {
                assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> login.login("runner01", "Runner9!"))
                        .isInstanceOfSatisfying(
                                ApiException.class,
                                ex -> assertThat(ex.code()).isEqualTo("SERVICE_UNAVAILABLE"));
                assertThat(redis.keys("runway:auth:family:*")).isEmpty();
            } finally {
                release.countDown();
                holder.get(10, TimeUnit.SECONDS);
            }
        }
    }
}
