package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.user.service.UserSettingsService;
import com.runway.backend.domain.user.validation.UserSettingsValidator;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.concurrent.*;

class UserSettingsApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired UserSettingsService service;
    @Autowired UserSettingsValidator validator;
    @Autowired PlatformTransactionManager transactions;
    long a;
    long b;
    static final String URL = "/api/v1/users/me/settings";

    @BeforeEach
    void seed() {
        a = user("settingsa");
        b = user("settingsb");
        signup.insertSettings(a);
        signup.insertSettings(b);
    }

    long user(String login) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '01012345678', 'DISAGREE') RETURNING id
                """,
                Long.class,
                login,
                login);
    }

    /**
     * 가입 기본값: BPM 안내(S15P31E105-706)와 그룹런·커뮤니티 알림(S15P31E105-801)은 켬, 음성 코칭은 끔이다.
     */
    void assertSignupDefaults(String body) {
        assertThat(body)
                .contains("\"voiceCoachingEnabled\":false")
                .contains("\"bpmGuideEnabled\":true")
                .contains("\"groupRun\":true")
                .contains("\"community\":true");
    }

    String read(long id) throws Exception {
        return mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(id)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    void patchOk(String body) throws Exception {
        mvc.perform(
                        patch(URL)
                                .header("Authorization", SecurityTestSupport.bearer(a))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isOk());
    }

    @Test
    void readSignupDefaultsAndPatchOnlyProvidedFields() throws Exception {
        assertThat(read(a))
                .contains("\"voiceCoachingEnabled\":false", "\"locationRecordingMode\":\"OFF\"");
        patchOk(
                "{\"voiceCoachingEnabled\":true,\"bpmGuideEnabled\":true,\"notifications\":{\"groupRun\":true,\"community\":true}}");
        patchOk("{\"bpmGuideEnabled\":false,\"notifications\":{\"community\":false}}");
        mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(a)))
                .andExpect(jsonPath("$.voiceCoachingEnabled").value(true))
                .andExpect(jsonPath("$.bpmGuideEnabled").value(false))
                .andExpect(jsonPath("$.notifications.groupRun").value(true))
                .andExpect(jsonPath("$.notifications.community").value(false))
                .andExpect(jsonPath("$.accountVisibility").doesNotExist());
        assertSignupDefaults(read(b));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT account_visibility::text FROM user_settings WHERE"
                                        + " user_id=?",
                                String.class,
                                a))
                .isEqualTo("PRIVATE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"ALWAYS", "RUNNING_ONLY", "OFF"})
    void locationDoesNotGrantConsent(String mode) throws Exception {
        patchOk("{\"locationRecordingMode\":\"" + mode + "\"}");
        assertThat(read(a)).contains("\"locationRecordingMode\":\"" + mode + "\"");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT health_data_access::text FROM users WHERE id=?",
                                String.class,
                                a))
                .isEqualTo("DISAGREE");
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{",
                "[]",
                "null",
                "{} {}",
                "{\"bpmGuideEnabled\":true,\"bpmGuideEnabled\":false}",
                "{\"notifications\":{\"groupRun\":true,\"groupRun\":false}}"
            })
    void rejectMalformedStructure(String body) throws Exception {
        reject(body, 400, "VALIDATION_ERROR");
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{\"voiceCoachingEnabled\":null}",
                "{\"bpmGuideEnabled\":1}",
                "{\"bpmGuideEnabled\":\"false\"}",
                "{\"locationRecordingMode\":\"off\"}",
                "{\"notifications\":null}",
                "{\"notifications\":[]}",
                "{\"notifications\":{\"coaching\":true}}",
                "{\"notifications\":{\"groupRun\":null}}",
                "{\"unknown\":true}",
                "{\"voiceCoachingEnabled\":true,\"notifications\":{\"community\":0}}"
            })
    void rejectInvalidSettingsWithoutPartialWrite(String body) throws Exception {
        reject(body, 422, "INVALID_SETTING");
    }

    void reject(String body, int status, String code) throws Exception {
        String before = read(a);
        mvc.perform(
                        patch(URL)
                                .header("Authorization", SecurityTestSupport.bearer(a))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code));
        assertThat(read(a)).isEqualTo(before);
    }

    @Test
    void emptyAndRepeatedPatchesPreserveValues() throws Exception {
        patchOk("{\"voiceCoachingEnabled\":true}");
        String before = read(a);
        patchOk("{}");
        patchOk("{\"notifications\":{}}");
        patchOk("{\"voiceCoachingEnabled\":true}");
        assertThat(read(a)).isEqualTo(before);
        mvc.perform(
                        patch(URL)
                                .header("Authorization", SecurityTestSupport.bearer(a))
                                .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest());
    }

    @Test
    void authenticationAndOwnership() throws Exception {
        for (String token : new String[] {"", "Bearer invalid", expiredBearer()}) {
            mvc.perform(get(URL).header("Authorization", token))
                    .andExpect(status().isUnauthorized());
            mvc.perform(
                            patch(URL)
                                    .header("Authorization", token)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{}"))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(
                        patch(URL)
                                .header("Authorization", SecurityTestSupport.bearer(a))
                                .header("X-User-Id", b)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"bpmGuideEnabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bpmGuideEnabled").value(false));
        // 다른 사용자(b)의 가입 기본값은 그대로다.
        assertSignupDefaults(read(b));
    }

    String expiredBearer() {
        var key =
                new javax.crypto.spec.SecretKeySpec(
                        java.util.Base64.getDecoder().decode(SecurityTestSupport.KEY),
                        "HmacSHA256");
        var issuer =
                new com.runway.backend.global.security.JwtAccessTokenService(
                        new org.springframework.security.oauth2.jwt.NimbusJwtEncoder(
                                new com.nimbusds.jose.jwk.source.ImmutableSecret<>(key)),
                        java.time.Clock.offset(
                                java.time.Clock.systemUTC(), java.time.Duration.ofHours(-1)));
        return "Bearer " + issuer.issue(a, java.time.Instant.now().plusSeconds(3600)).accessToken();
    }

    @Test
    void missingRowsDoNotAutoCreate() throws Exception {
        jdbc.update("DELETE FROM user_settings WHERE user_id=?", a);
        for (long id : new long[] {a, Long.MAX_VALUE}) {
            mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(id)))
                    .andExpect(status().isServiceUnavailable());
            mvc.perform(
                            patch(URL)
                                    .header("Authorization", SecurityTestSupport.bearer(id))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{}"))
                    .andExpect(status().isServiceUnavailable());
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_settings WHERE user_id=?",
                                Integer.class,
                                a))
                .isZero();
    }

    @Test
    void lockTimeoutReturns503WithoutChangingSettings() throws Exception {
        String before = read(a);
        try (var connection = jdbc.getDataSource().getConnection()) {
            connection.setAutoCommit(false);
            try (var lock =
                    connection.prepareStatement(
                            "SELECT id FROM user_settings WHERE user_id=? FOR UPDATE")) {
                lock.setLong(1, a);
                try (var rows = lock.executeQuery()) {
                    assertThat(rows.next()).isTrue();
                }
                mvc.perform(
                                patch(URL)
                                        .header("Authorization", SecurityTestSupport.bearer(a))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"voiceCoachingEnabled\":true}"))
                        .andExpect(status().isServiceUnavailable())
                        .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
            } finally {
                connection.rollback();
            }
        }
        assertThat(read(a)).isEqualTo(before);
    }

    @Test
    void databaseFailureRollsBack() throws Exception {
        jdbc.execute(
                "ALTER TABLE user_settings ADD CONSTRAINT settings_test_failure CHECK (NOT"
                        + " voice_coaching_enabled)");
        try {
            String before = read(a);
            mvc.perform(
                            patch(URL)
                                    .header("Authorization", SecurityTestSupport.bearer(a))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            "{\"voiceCoachingEnabled\":true,\"bpmGuideEnabled\":true}"))
                    .andExpect(status().is5xxServerError());
            assertThat(read(a)).isEqualTo(before);
        } finally {
            jdbc.execute("ALTER TABLE user_settings DROP CONSTRAINT settings_test_failure");
        }
    }

    @Test
    void concurrentPatchesPreserveFieldsAndVisibility() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch written = new CountDownLatch(1), attempted = new CountDownLatch(1);
        try {
            var first =
                    executor.submit(
                            () ->
                                    new TransactionTemplate(transactions)
                                            .execute(
                                                    s -> {
                                                        service.update(
                                                                a,
                                                                validator.parse(
                                                                        "{\"voiceCoachingEnabled\":true,\"bpmGuideEnabled\":true}"));
                                                        jdbc.update(
                                                                "UPDATE user_settings SET"
                                                                    + " account_visibility='PUBLIC'"
                                                                    + " WHERE user_id=?",
                                                                a);
                                                        written.countDown();
                                                        try {
                                                            assertThat(
                                                                            attempted.await(
                                                                                    5,
                                                                                    TimeUnit
                                                                                            .SECONDS))
                                                                    .isTrue();
                                                            long deadline =
                                                                    System.nanoTime()
                                                                            + TimeUnit.MILLISECONDS
                                                                                    .toNanos(1500);
                                                            boolean blocked = false;
                                                            while (System.nanoTime() < deadline) {
                                                                jdbc.execute(
                                                                        "SELECT"
                                                                            + " pg_stat_clear_snapshot()");
                                                                blocked =
                                                                        Boolean.TRUE.equals(
                                                                                jdbc.queryForObject(
                                                                                        """
                                                                                        SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                                                                                            WHERE datname=current_database() AND pid<>pg_backend_pid()
                                                                                            AND query LIKE 'UPDATE user_settings SET%'
                                                                                            AND cardinality(pg_blocking_pids(pid)) > 0)
                                                                                        """,
                                                                                        Boolean
                                                                                                .class));
                                                                if (blocked) {
                                                                    break;
                                                                }
                                                                Thread.sleep(10);
                                                            }
                                                            assertThat(blocked)
                                                                    .as(
                                                                            "second UPDATE is"
                                                                                + " blocked by"
                                                                                + " first"
                                                                                + " transaction")
                                                                    .isTrue();
                                                        } catch (InterruptedException ex) {
                                                            Thread.currentThread().interrupt();
                                                            throw new RuntimeException(ex);
                                                        }
                                                        return null;
                                                    }));
            var second =
                    executor.submit(
                            () -> {
                                try {
                                    assertThat(written.await(5, TimeUnit.SECONDS)).isTrue();
                                } catch (InterruptedException ex) {
                                    throw new RuntimeException(ex);
                                }
                                attempted.countDown();
                                return service.update(
                                        a,
                                        validator.parse(
                                                "{\"bpmGuideEnabled\":false,\"notifications\":{\"community\":true}}"));
                            });
            first.get(10, TimeUnit.SECONDS);
            var response = second.get(10, TimeUnit.SECONDS);
            assertThat(response.voiceCoachingEnabled()).isTrue();
            assertThat(response.bpmGuideEnabled()).isFalse();
            assertThat(response.notifications().community()).isTrue();
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT account_visibility::text FROM user_settings WHERE"
                                            + " user_id=?",
                                    String.class,
                                    a))
                    .isEqualTo("PUBLIC");
        } finally {
            executor.shutdownNow();
        }
    }
}
