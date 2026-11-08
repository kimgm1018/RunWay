package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.user.repository.UserProfileRepository;
import com.runway.backend.domain.user.service.OnboardingStatusService;
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

import java.sql.DriverManager;
import java.time.Instant;

@ExtendWith(OutputCaptureExtension.class)
class RunningProfileFailureIntegrationTest extends AuthIntegrationSupport {
    @Autowired UserProfileRepository profiles;
    @Autowired OnboardingStatusService onboarding;
    @Autowired jakarta.persistence.EntityManager entities;
    @Autowired JwtAccessTokenService tokens;

    static final String BODY =
            """
            {"selfReportedLevel":"ADVANCED","inputType":"PACE","usualPaceSecPerKm":400}
            """;

    String token() {
        return tokens.issue(user, Instant.now().plusSeconds(3600)).accessToken();
    }

    void unavailable() throws Exception {
        mvc.perform(
                        patch(RunningProfileApiIntegrationTest.PROFILE)
                                .header("Authorization", "Bearer " + token())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(BODY))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.details").isEmpty());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void flushFailureRollsBackInitialAndExistingProfile(boolean existing, CapturedOutput output)
            throws Exception {
        if (existing)
            jdbc.update(
                    """
                    INSERT INTO user_profiles(user_id,running_level,average_pace,distance,duraction)
                    VALUES (?,'BEGINNER',360,5000,1800)
                    """,
                    user);
        doAnswer(
                        call -> {
                            entities.flush();
                            throw new DataAccessResourceFailureException(
                                    "synthetic-private-input-223");
                        })
                .when(profiles)
                .flush();
        unavailable();
        if (existing) {
            var saved =
                    jdbc.queryForMap(
                            "SELECT running_level::text,average_pace,distance,duraction"
                                    + " FROM user_profiles WHERE user_id=?",
                            user);
            assertThat(saved.get("running_level")).isEqualTo("BEGINNER");
            assertThat(saved.get("distance")).isEqualTo(5000);
            assertThat(saved.get("duraction")).isEqualTo(1800);
            assertThat(saved.get("average_pace").toString()).isEqualTo("360.00");
        } else {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                    .isZero();
            assertThat(onboarding.isCompleted(user)).isFalse();
        }
        assertThat(output.toString()).doesNotContain("synthetic-private-input-223");
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{\"selfReportedLevel\":\"ADVANCED\"}",
                "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":400}"
            })
    void failedPartialPatchPreservesAllExistingFields(String body) throws Exception {
        jdbc.update(
                "INSERT INTO user_profiles(user_id,running_level,average_pace,distance,duraction)"
                        + " VALUES (?,'BEGINNER',360,5000,1800)",
                user);
        doAnswer(
                        call -> {
                            entities.flush();
                            throw new DataAccessResourceFailureException(
                                    "synthetic partial failure");
                        })
                .when(profiles)
                .flush();
        mvc.perform(
                        patch(RunningProfileApiIntegrationTest.PROFILE)
                                .header("Authorization", "Bearer " + token())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isServiceUnavailable());
        var row =
                jdbc.queryForMap(
                        "SELECT running_level::text,average_pace,distance,duraction"
                                + " FROM user_profiles WHERE user_id=?",
                        user);
        assertThat(row.get("running_level")).isEqualTo("BEGINNER");
        assertThat(row.get("average_pace").toString()).isEqualTo("360.00");
        assertThat(row.get("distance")).isEqualTo(5000);
        assertThat(row.get("duraction")).isEqualTo(1800);
    }

    @Test
    void deferredConstraintFailureAtCommitCannotReturnSuccess() throws Exception {
        // Only the disposable Testcontainers database is modified; production migrations stay
        // intact.
        jdbc.execute(
                """
                CREATE FUNCTION fail_profile_commit_223() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic deferred commit failure'; END $$
                """);
        jdbc.execute(
                """
                CREATE CONSTRAINT TRIGGER fail_profile_commit_223
                AFTER INSERT ON user_profiles DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION fail_profile_commit_223()
                """);
        try {
            unavailable();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                    .isZero();
            assertThat(onboarding.isCompleted(user)).isFalse();
        } finally {
            jdbc.execute("DROP TRIGGER fail_profile_commit_223 ON user_profiles");
            jdbc.execute("DROP FUNCTION fail_profile_commit_223()");
        }
    }

    @Test
    void realOwnerLockTimeoutReturns503WithoutCreatingProfile() throws Exception {
        try (var connection =
                DriverManager.getConnection(
                        DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword())) {
            connection.setAutoCommit(false);
            try (var statement =
                    connection.prepareStatement("SELECT id FROM users WHERE id=? FOR UPDATE")) {
                statement.setLong(1, user);
                statement.executeQuery().close();
            }
            try {
                unavailable();
                assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                        .isZero();
            } finally {
                connection.rollback();
            }
        }
        assertThat(onboarding.isCompleted(user)).isFalse();
    }

    @Test
    void readStorageFailureIsUnavailableAndDoesNotExposeCause(CapturedOutput output)
            throws Exception {
        doThrow(new DataAccessResourceFailureException("synthetic-private-read-223"))
                .when(profiles)
                .findByUserId(user);
        for (String path : java.util.List.of(RunningProfileApiIntegrationTest.PROFILE)) {
            mvc.perform(get(path).header("Authorization", "Bearer " + token()))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                    .andExpect(jsonPath("$.details").isEmpty());
        }
        assertThat(output.toString()).doesNotContain("synthetic-private-read-223");
    }
}
