package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class RefreshCommitFailureIntegrationTest extends RefreshIntegrationSupport {
    @MockitoSpyBean RefreshTokenStore spiedStore;
    @MockitoSpyBean JwtAccessTokenService spiedAccess;

    @Test
    void commitFailureAfterRotationReturns503AndRevokesUsingOldHistory() throws Exception {
        var token = grant();
        doAnswer(
                        call -> {
                            call.callRealMethod();
                            TransactionSynchronizationManager.registerSynchronization(
                                    new TransactionSynchronization() {
                                        @Override
                                        public void beforeCommit(boolean readOnly) {
                                            throw new DataAccessResourceFailureException(
                                                    "synthetic commit failure");
                                        }
                                    });
                            return null;
                        })
                .when(spiedStore)
                .rotate(any(), any(), any());
        request("refresh", token.value())
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(jsonPath("$.refreshToken").doesNotExist());
        assertThat(redis.opsForHash().get(key(token), "used:" + token.hash())).isEqualTo("1");
        assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
        verify(spiedStore, times(1)).rotate(any(), any(), any());
    }

    @Test
    void jwtFailureNeverConsumesTokenOrReturnsPair() throws Exception {
        var token = grant();
        doThrow(new IllegalStateException("synthetic sensitive JWT failure"))
                .when(spiedAccess)
                .issue(anyLong(), any());
        request("refresh", token.value())
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.accessToken").doesNotExist());
        verify(spiedStore, never()).rotate(any(), any(), any());
        assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
    }

    @Test
    void databaseFailureBeforeRotationIs503() throws Exception {
        var token = grant();
        try (var connection =
                java.sql.DriverManager.getConnection(
                        DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword())) {
            connection.setAutoCommit(false);
            try (var statement =
                    connection.prepareStatement("SELECT id FROM users WHERE id=? FOR UPDATE")) {
                statement.setLong(1, user);
                statement.executeQuery().close();
            }
            request("refresh", token.value())
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
            connection.rollback();
        }
        verify(spiedStore, never()).rotate(any(), any(), any());
        assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("REVOKED");
    }
}
