package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.*;

class RefreshHttpConcurrencyIntegrationTest extends RefreshIntegrationSupport {
    @Autowired RefreshTokenStore spiedStore;

    @Test
    void twoHttpRequestsReadSameCandidateThenOnlyOneRotates() throws Exception {
        var token = grant();
        var candidates = new CyclicBarrier(2);
        doAnswer(
                        call -> {
                            var result = call.callRealMethod();
                            candidates.await(10, TimeUnit.SECONDS);
                            return result;
                        })
                .when(spiedStore)
                .find(any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> request("refresh", token.value()).andReturn());
            var second = pool.submit(() -> request("refresh", token.value()).andReturn());
            var a = first.get(15, TimeUnit.SECONDS);
            var b = second.get(15, TimeUnit.SECONDS);
            assertThat(java.util.List.of(a.getResponse().getStatus(), b.getResponse().getStatus()))
                    .containsExactlyInAnyOrder(200, 401);
            var success = a.getResponse().getStatus() == 200 ? a : b;
            String replacement =
                    mapper.readTree(success.getResponse().getContentAsString())
                            .get("refreshToken")
                            .asString();
            reset(spiedStore);
            assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
            request("refresh", replacement)
                    .andExpect(
                            org.springframework.test.web.servlet.result.MockMvcResultMatchers
                                    .status()
                                    .isUnauthorized());
        }
    }

    @Test
    void httpLogoutAfterCandidateReadWinsBeforeRotation() throws Exception {
        var token = grant();
        var read = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            var result = call.callRealMethod();
                            read.countDown();
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            return result;
                        })
                .when(spiedStore)
                .find(any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = pool.submit(() -> request("refresh", token.value()).andReturn());
            try {
                assertThat(read.await(10, TimeUnit.SECONDS)).isTrue();
                assertThat(request("logout", token.value()).andReturn().getResponse().getStatus())
                        .isEqualTo(204);
            } finally {
                release.countDown();
            }
            assertThat(pending.get(15, TimeUnit.SECONDS).getResponse().getStatus()).isEqualTo(401);
            assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
            assertThat(redis.opsForHash().get(key(token), "currentTokenHash"))
                    .isEqualTo(token.hash());
        }
    }

    @Test
    void httpLogoutAfterRotationRevokesBeforeRefreshTransactionReturns() throws Exception {
        var token = grant();
        var rotated = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            assertThat(
                                            TransactionSynchronizationManager
                                                    .isActualTransactionActive())
                                    .isTrue();
                            var result = call.callRealMethod();
                            rotated.countDown();
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            return result;
                        })
                .when(spiedStore)
                .rotate(any(), any(), any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = pool.submit(() -> request("refresh", token.value()).andReturn());
            try {
                assertThat(rotated.await(10, TimeUnit.SECONDS)).isTrue();
                assertThat(request("logout", token.value()).andReturn().getResponse().getStatus())
                        .isEqualTo(204);
            } finally {
                release.countDown();
            }
            var response = pending.get(15, TimeUnit.SECONDS).getResponse();
            assertThat(response.getStatus()).isEqualTo(200);
            String replacement =
                    mapper.readTree(response.getContentAsString()).get("refreshToken").asString();
            assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
            reset(spiedStore);
            request("refresh", replacement)
                    .andExpect(
                            org.springframework.test.web.servlet.result.MockMvcResultMatchers
                                    .status()
                                    .isUnauthorized());
        }
    }
}
