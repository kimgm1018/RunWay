package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.sql.DriverManager;
import java.util.concurrent.atomic.AtomicReference;

class LoginPersistenceIntegrationTest extends AuthIntegrationSupport {
    @Autowired RefreshTokenStore store;

    @Test
    void storageAndResponseFailure() throws Exception {
        String counterKey =
                com.runway.backend.domain.auth.repository.LoginAttemptStore.key("runner01");
        new com.runway.backend.domain.auth.repository.LoginAttemptStore(redis)
                .recordFailure("runner01");
        var saved = new AtomicReference<IssuedRefreshToken>();
        doAnswer(
                        call -> {
                            IssuedRefreshToken token = call.getArgument(0);
                            saved.set(token);
                            call.callRealMethod();
                            throw new org.springframework.dao.QueryTimeoutException(
                                    "synthetic lost response");
                        })
                .when(store)
                .createForLogin(any(), org.mockito.ArgumentMatchers.anyString());
        unavailable();
        assertThat(redis.hasKey(counterKey)).isFalse();
        assertThat(
                        redis.opsForHash()
                                .get(RefreshTokenStore.familyKey(saved.get().familyId()), "state"))
                .isEqualTo("REVOKED");
        verify(store, times(1)).createForLogin(any(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void pendingMutationFailureCannotReturnTokens() throws Exception {
        var saved = new AtomicReference<IssuedRefreshToken>();
        doAnswer(
                        call -> {
                            IssuedRefreshToken token = call.getArgument(0);
                            saved.set(token);
                            redis.opsForHash()
                                    .putAll(
                                            RefreshTokenStore.familyKey(token.familyId()),
                                            java.util.Map.of(
                                                    "state",
                                                    "PENDING",
                                                    "userId",
                                                    Long.toString(token.userId()),
                                                    "currentTokenHash",
                                                    token.hash()));
                            throw new org.springframework.dao.DataAccessResourceFailureException(
                                    "synthetic partial write");
                        })
                .when(store)
                .createForLogin(any(), org.mockito.ArgumentMatchers.anyString());
        unavailable();
        assertThat(
                        redis.opsForHash()
                                .get(RefreshTokenStore.familyKey(saved.get().familyId()), "state"))
                .isEqualTo("REVOKED");
    }

    @Test
    void databaseCommitFailureAfterRedisWriteIsCompensated() throws Exception {
        String counterKey =
                com.runway.backend.domain.auth.repository.LoginAttemptStore.key("runner01");
        new com.runway.backend.domain.auth.repository.LoginAttemptStore(redis)
                .recordFailure("runner01");
        var saved = new AtomicReference<IssuedRefreshToken>();
        doAnswer(
                        call -> {
                            IssuedRefreshToken token = call.getArgument(0);
                            saved.set(token);
                            call.callRealMethod();
                            int backend =
                                    jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
                            // Only the backend of this disposable Testcontainers database is
                            // terminated.
                            try (var connection =
                                            DriverManager.getConnection(
                                                    DATABASE.getJdbcUrl(),
                                                    DATABASE.getUsername(),
                                                    DATABASE.getPassword());
                                    var statement =
                                            connection.prepareStatement(
                                                    "SELECT pg_terminate_backend(?)")) {
                                statement.setInt(1, backend);
                                statement.execute();
                            }
                            return null;
                        })
                .when(store)
                .createForLogin(any(), org.mockito.ArgumentMatchers.anyString());
        unavailable();
        assertThat(redis.hasKey(counterKey)).isFalse();
        assertThat(
                        redis.opsForHash()
                                .get(RefreshTokenStore.familyKey(saved.get().familyId()), "state"))
                .isEqualTo("REVOKED");
    }

    @Test
    @org.junit.jupiter.api.extension.ExtendWith(
            org.springframework.boot.test.system.OutputCaptureExtension.class)
    void failedCompensationKeepsOnlyAnUndeliveredExpiringGrant(
            org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        var saved = new AtomicReference<IssuedRefreshToken>();
        doReturn(false).when(store).revokeUndelivered(any());
        doAnswer(
                        call -> {
                            IssuedRefreshToken token = call.getArgument(0);
                            saved.set(token);
                            call.callRealMethod();
                            int backend =
                                    jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
                            try (var connection =
                                            DriverManager.getConnection(
                                                    DATABASE.getJdbcUrl(),
                                                    DATABASE.getUsername(),
                                                    DATABASE.getPassword());
                                    var statement =
                                            connection.prepareStatement(
                                                    "SELECT pg_terminate_backend(?)")) {
                                statement.setInt(1, backend);
                                statement.execute();
                            }
                            return null;
                        })
                .when(store)
                .createForLogin(any(), org.mockito.ArgumentMatchers.anyString());
        unavailable();
        var token = saved.get();
        String key = RefreshTokenStore.familyKey(token.familyId());
        assertThat(redis.opsForHash().get(key, "state")).isEqualTo("ACTIVE");
        assertThat(redis.opsForHash().get(key, "expiresAt"))
                .isEqualTo(Long.toString(token.expiresAt().getEpochSecond()));
        assertThat(redis.getExpire(key)).isBetween(2591900L, 2592000L);
        assertThat(output.getAll())
                .contains("전달되지 않은 로그인 권한의 폐기를 확인하지 못했습니다.")
                .doesNotContain("Runner9!", token.value(), token.hash(), encoded);
    }

    @Test
    void failureBeforeRedisWriteDoesNotCreateGrant() throws Exception {
        var attempts = new com.runway.backend.domain.auth.repository.LoginAttemptStore(redis);
        attempts.recordFailure("runner01");
        String counterKey =
                com.runway.backend.domain.auth.repository.LoginAttemptStore.key("runner01");
        String before = redis.opsForValue().get(counterKey);
        doThrow(
                        new org.springframework.dao.DataAccessResourceFailureException(
                                "synthetic unavailable"))
                .when(store)
                .createForLogin(any(), org.mockito.ArgumentMatchers.anyString());
        unavailable();
        assertThat(redis.opsForValue().get(counterKey)).isEqualTo(before);
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
    }

    private void unavailable() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(jsonPath("$.refreshToken").doesNotExist());
    }
}
