package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.Map;

class SignupApiIntegrationTest extends AuthIntegrationSupport {
    @Autowired JsonMapper mapper;
    @Autowired JwtDecoder decoder;

    String signup(Map<String, Object> payload, int status) throws Exception {
        return mvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(mapper.writeValueAsString(payload)))
                .andExpect(status().is(status))
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void persistsOnlyHealthConsentSettingsAndCompatibleCredentials(boolean health)
            throws Exception {
        var before = Instant.now();
        var response =
                mvc.perform(
                                post("/api/v1/auth/signup")
                                        .header("Authorization", "Bearer obsolete")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                mapper.writeValueAsString(
                                                        SignupValidationTest.payload(
                                                                "newrunner", "새러너", health))))
                        .andExpect(status().isCreated())
                        .andExpect(header().string("Cache-Control", "no-store"))
                        .andExpect(jsonPath("$.onboardingCompleted").value(false))
                        .andExpect(cookie().doesNotExist("JSESSIONID"))
                        .andReturn()
                        .getResponse();
        var body = mapper.readTree(response.getContentAsString());
        long id = body.get("user").get("id").asLong();
        assertThat(id).isPositive();
        mvc.perform(get("/api/v1/users/me/settings")
                        .header("Authorization", "Bearer " + body.get("accessToken").asString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.voiceCoachingEnabled").value(false))
                // S15P31E105-706: BPM 안내만 기본 켬이다.
                .andExpect(jsonPath("$.bpmGuideEnabled").value(true))
                .andExpect(jsonPath("$.locationRecordingMode").value("OFF"))
                .andExpect(jsonPath("$.notifications.groupRun").value(false))
                .andExpect(jsonPath("$.notifications.community").value(false));
        assertThat(body.get("user").get("loginId").asString()).isEqualTo("newrunner");
        var saved =
                jdbc.queryForMap(
                        "SELECT password,health_data_access::text,account_status::text FROM users"
                                + " WHERE id=?",
                        id);
        assertThat(passwords.matches("Runner9!", saved.get("password").toString())).isTrue();
        assertThat(saved.get("health_data_access")).isEqualTo(health ? "AGREE" : "DISAGREE");
        assertThat(saved.get("account_status")).isEqualTo("ACTIVE");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_profiles WHERE user_id=?",
                                Integer.class,
                                id))
                .isZero();
        var settings = jdbc.queryForMap("SELECT * FROM user_settings WHERE user_id=?", id);
        for (String key :
                new String[] {
                    "voice_coaching_enabled",
                    "group_notifications_enabled",
                    "community_notifications_enabled"
                }) assertThat(settings.get(key)).isEqualTo(false);
        assertThat(settings.get("bpm_guide_enabled")).isEqualTo(true);
        assertThat(settings.get("location_collection_mode").toString()).isEqualTo("OFF");
        assertThat(settings.get("account_visibility").toString()).isEqualTo("PRIVATE");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='user_consent_events'",
                                Integer.class))
                .isZero();
        var jwt = decoder.decode(body.get("accessToken").asString());
        assertThat(jwt.getSubject()).isEqualTo(Long.toString(id));
        assertThat(body.get("expiresInSec").asLong()).isBetween(1L, 600L);
        assertThat(Instant.parse(body.get("refreshExpiresAt").asString()).getEpochSecond())
                .isBetween(
                        before.getEpochSecond() + 2592000,
                        Instant.now().getEpochSecond() + 2592000);
        String refresh = body.get("refreshToken").asString();
        String family = RefreshTokenStore.familyKey(refresh.split("\\.")[0]);
        assertThat(redis.opsForHash().get(family, "state")).isEqualTo("ACTIVE");
        assertThat(redis.opsForHash().entries(family).values()).doesNotContain(refresh);
        mvc.perform(
                        get("/api/v1/users/me/crews")
                                .header(
                                        "Authorization",
                                        "Bearer " + body.get("accessToken").asString()))
                .andExpect(status().isOk());
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"loginId\":\"newrunner\",\"password\":\"Runner9!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onboardingCompleted").value(false));
    }

    @Test
    void duplicatesAndReplayDoNotCreatePartialAccounts() throws Exception {
        signup(SignupValidationTest.payload("newrunner", "새러너", false), 201);
        assertThat(
                        mapper.readTree(
                                        signup(
                                                SignupValidationTest.payload(
                                                        "newrunner", "다른닉네임", false),
                                                409))
                                .get("code")
                                .asString())
                .isEqualTo("LOGIN_ID_DUPLICATED");
        assertThat(
                        mapper.readTree(
                                        signup(
                                                SignupValidationTest.payload(
                                                        "othernew", "새러너", false),
                                                409))
                                .get("code")
                                .asString())
                .isEqualTo("NICKNAME_DUPLICATED");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM users WHERE login_id IN"
                                        + " ('newrunner','othernew')",
                                Integer.class))
                .isEqualTo(1);
        assertThat(redis.keys("runway:auth:family:*")).hasSize(1);
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE"
                        + " login_id='newrunner'");
        assertThat(
                        mapper.readTree(
                                        signup(
                                                SignupValidationTest.payload(
                                                        "newrunner", "또다른닉네임", false),
                                                409))
                                .get("code")
                                .asString())
                .isEqualTo("LOGIN_ID_DUPLICATED");
    }

    @Test
    void transportValidationAndMemberAuthenticationArePreserved() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        var invalid = SignupValidationTest.payload("bad", "새러너", false);
        signup(invalid, 400);
        invalid = SignupValidationTest.payload("runner02", "새러너", false);
        invalid.put("password", "short");
        assertThat(mapper.readTree(signup(invalid, 422)).get("code").asString())
                .isEqualTo("INVALID_PASSWORD_POLICY");
        // S15P31E105-773: 앱을 거치지 않은 요청도 한글·아이디와 같은 비밀번호를 거절한다.
        for (String password : java.util.List.of("비밀번호12345", "RUNNER02")) {
            invalid = SignupValidationTest.payload("runner02", "새러너", false);
            invalid.put("password", password);
            assertThat(mapper.readTree(signup(invalid, 422)).get("code").asString())
                    .isEqualTo("INVALID_PASSWORD_POLICY");
        }
        mvc.perform(get("/api/v1/users/me/crews")).andExpect(status().isUnauthorized());
        for (int required = 0; required < 3; required++) {
            var rejected = SignupValidationTest.payload("runner02", "새러너", false);
            @SuppressWarnings("unchecked")
            var consents = (java.util.List<Map<String, Object>>) rejected.get("consents");
            consents.get(required).put("granted", false);
            assertThat(mapper.readTree(signup(rejected, 422)).get("code").asString())
                    .isEqualTo("INVALID_CONSENT");
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
    }
}
