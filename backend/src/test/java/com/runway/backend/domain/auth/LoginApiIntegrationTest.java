package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

class LoginApiIntegrationTest extends AuthIntegrationSupport {
    @Autowired JsonMapper mapper;
    @Autowired JwtDecoder decoder;

    @Test
    void documentationUsesStringCredentialsDespiteStrictJsonValidation() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.components.schemas.LoginRequest.properties.loginId.type")
                                .value("string"))
                .andExpect(
                        jsonPath("$.components.schemas.LoginRequest.properties.password.type")
                                .value("string"))
                .andExpect(
                        jsonPath("$.components.schemas.LoginRequest.properties.password.maxLength")
                                .value(20));
    }

    String login(String id, String password) throws Exception {
        return mvc.perform(
                        post("/api/v1/auth/login")
                                .header("Authorization", "Bearer obsolete")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        mapper.writeValueAsString(
                                                java.util.Map.of(
                                                        "loginId", id, "password", password))))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(cookie().doesNotExist("JSESSIONID"))
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    @Test
    void successAndMemberAccess() throws Exception {
        var before = Instant.now();
        var body = mapper.readTree(login("runner01", "Runner9!"));
        assertThat(body.get("user").get("id").asLong()).isEqualTo(user);
        assertThat(body.get("onboardingCompleted").asBoolean()).isFalse();
        String access = body.get("accessToken").asString();
        var jwt = decoder.decode(access);
        assertThat(jwt.getSubject()).isEqualTo(Long.toString(user));
        assertThat(jwt.getClaimAsString("iss")).isEqualTo("runway-backend");
        assertThat(jwt.getAudience()).contains("runway-api");
        assertThat(body.get("expiresInSec").asLong()).isBetween(1L, 600L);
        assertThat(Instant.parse(body.get("refreshExpiresAt").asString()).getEpochSecond())
                .isBetween(
                        before.getEpochSecond() + 2592000,
                        Instant.now().getEpochSecond() + 2592000);
        mvc.perform(get("/api/v1/users/me/crews").header("Authorization", "Bearer " + access))
                .andExpect(status().isOk());
        String refresh = body.get("refreshToken").asString();
        String key = RefreshTokenStore.familyKey(refresh.split("\\.")[0]);
        String digest =
                HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest(refresh.getBytes(StandardCharsets.UTF_8)));
        assertThat(redis.opsForHash().get(key, "currentTokenHash")).isEqualTo(digest);
        assertThat(redis.opsForHash().entries(key).values()).doesNotContain(refresh);
        assertThat(redis.opsForHash().get(key, "state")).isEqualTo("ACTIVE");
        assertThat(redis.getExpire(key)).isBetween(2591900L, 2592000L);
        var again = mapper.readTree(login("runner01", "Runner9!"));
        assertThat(again.get("refreshToken").asString()).isNotEqualTo(refresh);
        assertThat(redis.opsForZSet().size(RefreshTokenStore.userKey(user))).isEqualTo(2);
    }

    @Test
    void sameCredentialError() throws Exception {
        String expected = null;
        for (String[] input :
                new String[][] {
                    {"missing1", "Runner9!"}, {"runner01", "Wrong999!"}, {"runner01", "Runner9!"}
                }) {
            if (input[1].equals("Runner9!") && input[0].equals("runner01"))
                jdbc.update(
                        "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE"
                            + " id=?",
                        user);
            String response =
                    mvc.perform(
                                    post("/api/v1/auth/login")
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content(
                                                    mapper.writeValueAsString(
                                                            java.util.Map.of(
                                                                    "loginId",
                                                                    input[0],
                                                                    "password",
                                                                    input[1]))))
                            .andExpect(status().isUnauthorized())
                            .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
                            .andExpect(jsonPath("$.details").isEmpty())
                            .andReturn()
                            .getResponse()
                            .getContentAsString();
            if (expected == null) expected = response;
            else assertThat(response).isEqualTo(expected);
        }
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
        assertThat(redis.keys("runway:auth:attempt:*")).hasSize(2);
    }

    @Test
    void onboardingStates() throws Exception {
        for (String level : new String[] {"BEGINNER", "INTERMEDIATE", "ADVANCED"}) {
            jdbc.update("DELETE FROM user_profiles");
            jdbc.update(
                    "INSERT INTO user_profiles(user_id,running_level,average_pace) VALUES"
                        + " (?,?::user_profiles_running_level_enum,360)",
                    user,
                    level);
            assertThat(
                            mapper.readTree(login("runner01", "Runner9!"))
                                    .get("onboardingCompleted")
                                    .asBoolean())
                    .isTrue();
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_profiles WHERE user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(1);
    }

    @Test
    void malformedStoredHashIsUnavailableWithoutLeak() throws Exception {
        jdbc.update("UPDATE users SET password=? WHERE id=?", "not-a-valid-encoded-password", user);
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString("Runner9!"))));
        assertThat(redis.keys("runway:auth:*")).isEmpty();
    }
}
