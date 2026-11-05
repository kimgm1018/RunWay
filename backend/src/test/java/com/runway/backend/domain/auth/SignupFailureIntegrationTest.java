package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;

import tools.jackson.databind.json.JsonMapper;

import java.sql.DriverManager;
import java.util.concurrent.atomic.AtomicReference;

@ExtendWith(OutputCaptureExtension.class)
class SignupFailureIntegrationTest extends AuthIntegrationSupport {
    @Autowired SignupRepository repository;
    @Autowired RefreshTokenStore store;
    @Autowired JwtAccessTokenService access;
    @Autowired JsonMapper mapper;

    void unavailable() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        mapper.writeValueAsString(
                                                SignupValidationTest.payload(
                                                        "failed01", "실패닉네임", false))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "accessToken"))));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM users WHERE login_id='failed01'",
                                Integer.class))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_settings", Integer.class))
                .isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"user", "settings", "jwt", "redis"})
    void everyStorageAndIssuanceFailureRollsBack(String stage, CapturedOutput output)
            throws Exception {
        var failure =
                new DataAccessResourceFailureException("synthetic-sensitive-Runner9!-01012345678");
        switch (stage) {
            case "user" -> doThrow(failure).when(repository).insertUser(any(), anyString());
            case "settings" -> doThrow(failure).when(repository).insertSettings(anyLong());
            case "jwt" -> doThrow(failure).when(access).issue(anyLong(), any());
            case "redis" -> doThrow(failure).when(store).create(any());
        }
        unavailable();
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
        assertThat(output.toString())
                .doesNotContain("synthetic-sensitive", "Runner9!", "01012345678");
    }

    @Test
    void redisWriteWithLostResponseIsCompensated(CapturedOutput output) throws Exception {
        var saved = new AtomicReference<IssuedRefreshToken>();
        doAnswer(
                        call -> {
                            saved.set(call.getArgument(0));
                            call.callRealMethod();
                            throw new DataAccessResourceFailureException(
                                    "synthetic-sensitive-Runner9!");
                        })
                .when(store)
                .create(any());
        unavailable();
        assertThat(
                        redis.opsForHash()
                                .get(RefreshTokenStore.familyKey(saved.get().familyId()), "state"))
                .isEqualTo("REVOKED");
        assertThat(output.toString())
                .doesNotContain(saved.get().value(), saved.get().hash(), "Runner9!");
    }

    @Test
    void databaseCommitFailureRevokesTheUndeliveredGrant() throws Exception {
        var saved = new AtomicReference<IssuedRefreshToken>();
        doAnswer(
                        call -> {
                            saved.set(call.getArgument(0));
                            call.callRealMethod();
                            int backend =
                                    jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
                            // Only this transaction in the disposable integration database is
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
                .create(any());
        unavailable();
        assertThat(
                        redis.opsForHash()
                                .get(RefreshTokenStore.familyKey(saved.get().familyId()), "state"))
                .isEqualTo("REVOKED");
    }

    @Test
    void compensationFailureIsNotReportedAsSuccessOrLoggedWithSecrets(CapturedOutput output)
            throws Exception {
        var saved = new AtomicReference<IssuedRefreshToken>();
        doReturn(false).when(store).revokeUndelivered(any());
        doAnswer(
                        call -> {
                            saved.set(call.getArgument(0));
                            call.callRealMethod();
                            throw new DataAccessResourceFailureException(
                                    "synthetic-sensitive-Runner9!");
                        })
                .when(store)
                .create(any());
        unavailable();
        var token = saved.get();
        String key = RefreshTokenStore.familyKey(token.familyId());
        assertThat(redis.opsForHash().get(key, "state")).isEqualTo("ACTIVE");
        assertThat(redis.getExpire(key)).isBetween(1L, 2592000L);
        assertThat(output.toString())
                .contains("전달되지 않은 가입 권한의 폐기를 확인하지 못했습니다.")
                .doesNotContain(token.value(), token.hash(), "synthetic-sensitive", "Runner9!");
    }

    @Test
    void availabilityDatabaseFailureIsUnavailable() throws Exception {
        doThrow(new DataAccessResourceFailureException("synthetic-private"))
                .when(repository)
                .loginIdExists(anyString());
        mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", "runner02"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
    }
}
