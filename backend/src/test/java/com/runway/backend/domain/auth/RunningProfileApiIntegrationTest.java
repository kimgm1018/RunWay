package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.global.security.JwtAccessTokenService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.List;

class RunningProfileApiIntegrationTest extends AuthIntegrationSupport {
    static final String PROFILE = "/api/v1/users/me/running-profile";
    static final String DISTANCE =
            """
            {"selfReportedLevel":"BEGINNER","inputType":"DISTANCE_TIME",
             "baselineDistanceM":5000,"baselineDurationSec":1800,"usualPaceSecPerKm":360}
            """;
    @Autowired JwtAccessTokenService tokens;
    @Autowired JsonMapper mapper;
    @Autowired org.springframework.security.oauth2.jwt.JwtEncoder encoder;

    String token(long id) {
        return tokens.issue(id, Instant.now().plusSeconds(3600)).accessToken();
    }

    JsonNode save(String path, String body, long id, int expected) throws Exception {
        return mapper.readTree(
                mvc.perform(
                                patch(path)
                                        .header("Authorization", "Bearer " + token(id))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().is(expected))
                        .andReturn()
                        .getResponse()
                        .getContentAsString());
    }

    @Test
    void createsReadsAndIndependentlyUpdatesOwnValues() throws Exception {
        for (String path : List.of(PROFILE)) {
            mvc.perform(get(path).header("Authorization", "Bearer " + token(user)))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("PROFILE_NOT_SET"));
        }
        assertThat(
                        save(
                                        PROFILE,
                                        "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":360}",
                                        user,
                                        422)
                                .get("code")
                                .asString())
                .isEqualTo("INVALID_LEVEL");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                .isZero();
        var first = save(PROFILE, DISTANCE, user, 200);
        assertThat(first.get("selfReportedLevel").asString()).isEqualTo("BEGINNER");
        assertThat(first.get("usualPaceSecPerKm").decimalValue()).isEqualByComparingTo("360.00");
        assertThat(first.get("onboardingCompleted").asBoolean()).isTrue();
        assertThat(first.has("inputType")).isFalse();
        assertThat(Instant.parse(first.get("updatedAt").asString()))
                .isEqualTo(
                        jdbc.<Instant>queryForObject(
                                "SELECT updated_at FROM user_profiles WHERE user_id=?",
                                (rs, n) -> rs.getTimestamp(1).toInstant(),
                                user));
        mvc.perform(get(PROFILE).header("Authorization", "Bearer " + token(user)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.baselineDistanceM").value(5000))
                .andExpect(jsonPath("$.baselineDurationSec").value(1800))
                .andExpect(jsonPath("$.usualPaceSecPerKm").value(360));
        var firstRead =
                mapper.readTree(
                        mvc.perform(get(PROFILE).header("Authorization", "Bearer " + token(user)))
                                .andExpect(status().isOk())
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        assertThat(firstRead).isEqualTo(first);
        var level = save(PROFILE, "{\"selfReportedLevel\":\"INTERMEDIATE\"}", user, 200);
        assertThat(level.get("baselineDistanceM").asInt()).isEqualTo(5000);
        assertThat(level.get("baselineDurationSec").asInt()).isEqualTo(1800);
        assertThat(level.get("usualPaceSecPerKm").decimalValue()).isEqualByComparingTo("360");
        var baseline =
                save(PROFILE, "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":400}", user, 200);
        assertThat(baseline.get("selfReportedLevel").asString()).isEqualTo("INTERMEDIATE");
        assertThat(baseline.get("onboardingCompleted").asBoolean()).isTrue();
        mvc.perform(get(PROFILE).header("Authorization", "Bearer " + token(user)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.selfReportedLevel").value("INTERMEDIATE"));
        var read =
                mapper.readTree(
                        mvc.perform(get(PROFILE).header("Authorization", "Bearer " + token(user)))
                                .andExpect(status().isOk())
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        assertThat(read.has("baselineDistanceM")).isTrue();
        assertThat(read.has("baselineDurationSec")).isTrue();
        assertThat(read.get("baselineDistanceM").isNull()).isTrue();
        assertThat(read.get("baselineDurationSec").isNull()).isTrue();
        assertThat(read.get("usualPaceSecPerKm").decimalValue()).isEqualByComparingTo("400");
        save(PROFILE, "{\"selfReportedLevel\":\"ADVANCED\"}", user, 200);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT average_pace FROM user_profiles WHERE user_id=?",
                                java.math.BigDecimal.class,
                                user))
                .isEqualByComparingTo("400");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT health_data_access::text FROM users WHERE id=?",
                                String.class,
                                user))
                .isEqualTo("DISAGREE");
    }

    @Test
    void initialPartialFailureAndRetryNeverCreatePartialOrDuplicateRows() throws Exception {
        assertThat(
                        save(PROFILE, "{\"selfReportedLevel\":\"BEGINNER\"}", user, 422)
                                .get("code")
                                .asString())
                .isEqualTo("INVALID_RUNNING_BASELINE");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                .isZero();
        save(PROFILE, DISTANCE, user, 200);
        save(PROFILE, DISTANCE, user, 200);
        save(PROFILE, "{\"selfReportedLevel\":\"ADVANCED\",\"inputType\":\"PACE\"}", user, 422);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT running_level::text FROM user_profiles", String.class))
                .isEqualTo("BEGINNER");
    }

    @Test
    void unifiedPatchRejectsEmptyAndIncompleteCreationWithoutWriting() throws Exception {
        assertThat(save(PROFILE, "{}", user, 400).get("code").asString())
                .isEqualTo("VALIDATION_ERROR");
        assertThat(
                        save(
                                        PROFILE,
                                        "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":5000,\"baselineDurationSec\":1800,\"usualPaceSecPerKm\":360}",
                                        user,
                                        422)
                                .get("code")
                                .asString())
                .isEqualTo("INVALID_LEVEL");
        assertThat(
                        save(PROFILE, "{\"selfReportedLevel\":\"UNKNOWN\"}", user, 422)
                                .get("code")
                                .asString())
                .isEqualTo("INVALID_LEVEL");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                .isZero();
        save(PROFILE, DISTANCE, user, 200);
        var before = jdbc.queryForMap("SELECT * FROM user_profiles WHERE user_id=?", user);
        save(PROFILE, "{}", user, 400);
        save(PROFILE, "{\"selfReportedLevel\":null}", user, 400);
        assertThat(jdbc.queryForMap("SELECT * FROM user_profiles WHERE user_id=?", user))
                .isEqualTo(before);
    }

    @Test
    void legacyEndpointsAreNotExposedAndOpenApiUsesUnifiedContract() throws Exception {
        mvc.perform(
                        put(PROFILE)
                                .header("Authorization", "Bearer " + token(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(DISTANCE))
                .andExpect(status().isMethodNotAllowed());
        String removed = "/api/v1/users/me/running-baseline";
        mvc.perform(get(removed).header("Authorization", "Bearer " + token(user)))
                .andExpect(status().isNotFound());
        mvc.perform(
                        put(removed)
                                .header("Authorization", "Bearer " + token(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(DISTANCE))
                .andExpect(status().isNotFound());
        mvc.perform(
                        patch(removed)
                                .header("Authorization", "Bearer " + token(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(DISTANCE))
                .andExpect(status().isNotFound());
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['" + PROFILE + "'].get").exists())
                .andExpect(jsonPath("$.paths['" + PROFILE + "'].patch").exists())
                .andExpect(jsonPath("$.paths['" + PROFILE + "'].put").doesNotExist())
                .andExpect(jsonPath("$.paths['" + removed + "']").doesNotExist());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void signupThenSetupThenLoginPreservesHealthConsent(boolean health) throws Exception {
        var signup =
                mapper.readTree(
                        mvc.perform(
                                        post("/api/v1/auth/signup")
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        mapper.writeValueAsString(
                                                                SignupValidationTest.payload(
                                                                        "setupnew",
                                                                        "초기러너",
                                                                        health))))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.onboardingCompleted").value(false))
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        long newUser = signup.get("user").get("id").asLong();
        String login = "{\"loginId\":\"setupnew\",\"password\":\"Runner9!\"}";
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(login))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onboardingCompleted").value(false));
        for (String level : List.of("BEGINNER", "INTERMEDIATE", "ADVANCED")) {
            save(
                    PROFILE,
                    "{\"selfReportedLevel\":\""
                            + level
                            + "\",\"inputType\":\"PACE\",\"usualPaceSecPerKm\":360}",
                    newUser,
                    200);
            mvc.perform(
                            post("/api/v1/auth/login")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(login))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.onboardingCompleted").value(true));
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT health_data_access::text FROM users WHERE id=?",
                                String.class,
                                newUser))
                .isEqualTo(health ? "AGREEE" : "DISAGREE");
    }

    @Test
    void everyEndpointRequiresRealJwtAndCannotSelectAnotherMember() throws Exception {
        long other =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('other223',?,'타인','2000-01-01','MALE','01000000000','DISAGREE') RETURNING id
                        """,
                        Long.class,
                        encoded);
        save(PROFILE, DISTANCE, other, 200);
        for (String path : List.of(PROFILE)) {
            for (String auth : List.of("", "Bearer invalid", "Bearer " + token(user) + "broken")) {
                mvc.perform(get(path).header("Authorization", auth).header("X-User-Id", other))
                        .andExpect(status().isUnauthorized());
                mvc.perform(
                                patch(path)
                                        .header("Authorization", auth)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(DISTANCE))
                        .andExpect(status().isUnauthorized());
            }
            mvc.perform(
                            get(path)
                                    .header("Authorization", "Bearer " + token(user))
                                    .param("userId", Long.toString(other))
                                    .header("X-User-Id", other))
                    .andExpect(status().isNotFound());
        }
        save(
                PROFILE,
                "{\"selfReportedLevel\":\"ADVANCED\",\"inputType\":\"PACE\","
                        + "\"usualPaceSecPerKm\":500}",
                user,
                200);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT running_level::text FROM user_profiles WHERE user_id=?",
                                String.class,
                                other))
                .isEqualTo("BEGINNER");
    }

    @Test
    void malformedJsonTypesAndExplicitNullAre400WithoutWrites() throws Exception {
        for (String payload :
                List.of(
                        "null",
                        "[]",
                        "{",
                        "{\"selfReportedLevel\":true}",
                        "{\"selfReportedLevel\":\"BEGINNER\",\"inputType\":null}",
                        "{\"selfReportedLevel\":\"BEGINNER\",\"usualPaceSecPerKm\":null}",
                        "{\"selfReportedLevel\":\"BEGINNER\",\"inputType\":\"PACE\",\"usualPaceSecPerKm\":NaN}")) {
            save(PROFILE, payload, user, 400);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                .isZero();
    }

    @Test
    void openApiDescribesNumbersAndExpiredTokenCannotReadOrWrite() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(
                                        "$.components.schemas.RunningProfileRequest.properties.usualPaceSecPerKm.type")
                                .value("number"))
                .andExpect(
                        jsonPath(
                                        "$.components.schemas.RunningProfileRequest.properties.baselineDistanceM.type")
                                .value("integer"))
                .andExpect(
                        jsonPath(
                                        "$.components.schemas.RunningProfileRequest.properties.formatValid")
                                .doesNotExist())
                .andExpect(
                        jsonPath(
                                        "$.components.schemas.RunningProfileResponse.properties.formatValid")
                                .doesNotExist());
        var claims =
                org.springframework.security.oauth2.jwt.JwtClaimsSet.builder()
                        .issuer(com.runway.backend.global.security.JwtAccessTokenValidator.ISSUER)
                        .audience(
                                List.of(
                                        com.runway.backend.global.security.JwtAccessTokenValidator
                                                .AUDIENCE))
                        .subject(Long.toString(user))
                        .issuedAt(Instant.now().minusSeconds(1200))
                        .expiresAt(Instant.now().minusSeconds(600))
                        .build();
        var header =
                org.springframework.security.oauth2.jwt.JwsHeader.with(
                                org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256)
                        .type("JWT")
                        .build();
        String expiredToken =
                encoder.encode(
                                org.springframework.security.oauth2.jwt.JwtEncoderParameters.from(
                                        header, claims))
                        .getTokenValue();
        for (String path : List.of(PROFILE)) {
            mvc.perform(get(path).header("Authorization", "Bearer " + expiredToken))
                    .andExpect(status().isUnauthorized());
            mvc.perform(
                            patch(path)
                                    .header("Authorization", "Bearer " + expiredToken)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(DISTANCE))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void distanceTimePersistsClientPaceForCreationAndPartialUpdate() throws Exception {
        String initial =
                "{\"selfReportedLevel\":\"BEGINNER\",\"inputType\":\"DISTANCE_TIME\","
                    + "\"baselineDistanceM\":5000,\"baselineDurationSec\":1800,\"usualPaceSecPerKm\":410.125}";
        var created = save(PROFILE, initial, user, 200);
        assertThat(created.get("usualPaceSecPerKm").decimalValue()).isEqualByComparingTo("410.13");
        var updated =
                save(
                        PROFILE,
                        "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":3000,"
                                + "\"baselineDurationSec\":1000,\"usualPaceSecPerKm\":350.125}",
                        user,
                        200);
        assertThat(updated.get("selfReportedLevel").asString()).isEqualTo("BEGINNER");
        assertThat(updated.get("usualPaceSecPerKm").decimalValue()).isEqualByComparingTo("350.13");
        var read =
                mapper.readTree(
                        mvc.perform(get(PROFILE).header("Authorization", "Bearer " + token(user)))
                                .andExpect(status().isOk())
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        assertThat(read).isEqualTo(updated);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT average_pace FROM user_profiles WHERE user_id=?",
                                java.math.BigDecimal.class,
                                user))
                .isEqualByComparingTo("350.13");
        var before = jdbc.queryForMap("SELECT * FROM user_profiles WHERE user_id=?", user);
        save(
                PROFILE,
                "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":3000,\"baselineDurationSec\":1000}",
                user,
                422);
        save(
                PROFILE,
                "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":3000,\"baselineDurationSec\":1000,\"usualPaceSecPerKm\":0}",
                user,
                422);
        save(
                PROFILE,
                "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":3000,\"baselineDurationSec\":1000,\"usualPaceSecPerKm\":null}",
                user,
                400);
        assertThat(jdbc.queryForMap("SELECT * FROM user_profiles WHERE user_id=?", user))
                .isEqualTo(before);
    }

    @Test
    void profileRejectsPartialMixedNullAndInvalidTypesWithoutChangingStoredValues()
            throws Exception {
        save(PROFILE, DISTANCE, user, 200);
        for (String body :
                List.of(
                        "{\"inputType\":\"OTHER\"}",
                        "{\"inputType\":\"PACE\"}",
                        "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":0}",
                        "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":5000}",
                        "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":400,\"baselineDurationSec\":2000}")) {
            assertThat(save(PROFILE, body, user, 422).get("code").asString())
                    .isEqualTo("INVALID_RUNNING_BASELINE");
        }
        for (String body :
                List.of(
                        "{}",
                        "{\"inputType\":null}",
                        "{\"inputType\":true}",
                        "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":null}",
                        "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":\"400\"}",
                        "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":2147483648,\"baselineDurationSec\":100}")) {
            save(PROFILE, body, user, 400);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT average_pace FROM user_profiles WHERE user_id=?",
                                java.math.BigDecimal.class,
                                user))
                .isEqualByComparingTo("360");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT distance FROM user_profiles WHERE user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(5000);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1e-2147483647", "1e-1000000000", "0.004"})
    void tinyPaceReturns422AndPreservesProfile(String pace) throws Exception {
        save(PROFILE, DISTANCE, user, 200);
        for (String path : List.of(PROFILE)) {
            String payload =
                    "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":"
                            + pace
                            + (path.equals(PROFILE) ? ",\"selfReportedLevel\":\"ADVANCED\"" : "")
                            + "}";
            assertThat(save(path, payload, user, 422).get("code").asString())
                    .isEqualTo("INVALID_RUNNING_BASELINE");
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT average_pace FROM user_profiles WHERE user_id=?",
                                java.math.BigDecimal.class,
                                user))
                .isEqualByComparingTo("360");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT running_level::text FROM user_profiles WHERE user_id=?",
                                String.class,
                                user))
                .isEqualTo("BEGINNER");
    }
}
