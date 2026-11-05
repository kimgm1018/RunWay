package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.concurrent.*;

class RefreshAccountStateIntegrationTest extends RefreshIntegrationSupport {
    @Autowired RefreshTokenStore spiedStore;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void serializesAccountStateAndIssuance() throws Exception {
        var token = grant();
        var candidateRead = new CountDownLatch(1);
        var proceed = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            Object found = call.callRealMethod();
                            candidateRead.countDown();
                            assertThat(proceed.await(10, TimeUnit.SECONDS)).isTrue();
                            return found;
                        })
                .when(spiedStore)
                .find(any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = pool.submit(() -> refresh.refresh(token.value()));
            try {
                assertThat(candidateRead.await(10, TimeUnit.SECONDS)).isTrue();
                jdbc.update(
                        "UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?",
                        user);
            } finally {
                proceed.countDown();
            }
            assertThatThrownBy(() -> pending.get(10, TimeUnit.SECONDS))
                    .hasCauseInstanceOf(ApiException.class);
            assertThat(redis.opsForHash().get(key(token), "currentTokenHash"))
                    .isEqualTo(token.hash());
        }
    }

    @Test
    void refreshLockPrecedesWithdrawalAndRevocation() throws Exception {
        var token = grant();
        var writing = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var attempted = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            writing.countDown();
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            return call.callRealMethod();
                        })
                .when(spiedStore)
                .rotate(any(), any(), any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var issuance = pool.submit(() -> refresh.refresh(token.value()));
            assertThat(writing.await(10, TimeUnit.SECONDS)).isTrue();
            var withdrawal =
                    pool.submit(
                            () ->
                                    new TransactionTemplate(transactions)
                                            .execute(
                                                    status -> {
                                                        attempted.countDown();
                                                        jdbc.update(
                                                                "UPDATE users SET"
                                                                    + " account_status='WITHDRAWN',withdrawn_at=now()"
                                                                    + " WHERE id=?",
                                                                user);
                                                        logout.logout(token.value());
                                                        return null;
                                                    }));
            try {
                assertThat(attempted.await(10, TimeUnit.SECONDS)).isTrue();
                assertThat(withdrawal.isDone()).isFalse();
            } finally {
                release.countDown();
            }
            var response = issuance.get(10, TimeUnit.SECONDS);
            withdrawal.get(10, TimeUnit.SECONDS);
            invalid(response.refreshToken());
            assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
        }
    }

    @Test
    void missingAccountCannotIssueNewTokens() {
        var token = grant();
        jdbc.update("DELETE FROM users WHERE id=?", user);
        invalid(token.value());
        assertThat(redis.opsForHash().get(key(token), "currentTokenHash")).isEqualTo(token.hash());
    }
}
