package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.user.model.PreferenceSelection;
import com.runway.backend.global.security.SecurityTestSupport;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

class PreferencesApiIntegrationTest extends PreferencesIntegrationSupport {
    static final String URL = "/api/v1/users/me/preferences";

    @Test
    void readUnsetDoesNotCreate() throws Exception {
        var result =
                mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(user)))
                        .andExpect(status().isOk())
                        .andReturn();
        var response = mapper.readTree(result.getResponse().getContentAsString());
        assertThat(response.size()).isEqualTo(2);
        assertThat(response.get("shape").asString()).isEqualTo("loop");
        assertThat(response.get("filters").size()).isEqualTo(9);
        for (String key : PreferenceSelection.FILTERS)
            assertThat(response.get("filters").get(key).booleanValue()).isFalse();
        assertThat(count()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles", Integer.class))
                .isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"loop", "out_and_back", "point_to_point"})
    void saveShapesAndRead(String shape) throws Exception {
        var payload = body(shape, false);
        ((ObjectNode) payload.get("filters")).put("flat", true).put("river", true);
        mvc.perform(
                        put(URL).header("Authorization", SecurityTestSupport.bearer(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(payload.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shape").value(shape))
                .andExpect(jsonPath("$.filters.flat").value(true))
                .andExpect(jsonPath("$.id").doesNotExist())
                .andExpect(jsonPath("$.user_id").doesNotExist());
        var result =
                mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(user)))
                        .andExpect(status().isOk())
                        .andReturn();
        assertThat(mapper.readTree(result.getResponse().getContentAsString())).isEqualTo(payload);
        assertThat(count()).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT id FROM user_recommendation_preferences WHERE user_id=?",
                                Long.class,
                                user))
                .isPositive();
    }

    @Test
    void replaceAndRepeat() throws Exception {
        service.save(user, selection("loop", true));
        var expected = body("out_and_back", false);
        for (int i = 0; i < 2; i++) {
            mvc.perform(
                            put(URL).header("Authorization", SecurityTestSupport.bearer(user))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(expected.toString()))
                    .andExpect(status().isOk());
        }
        assertThat(service.read(user)).isEqualTo(selection("out_and_back", false));
        assertThat(count()).isEqualTo(1);
        assertThat(service.read(other)).isEqualTo(PreferenceSelection.defaults());
    }

    @Test
    void strictPayloadsPreserveExistingState() throws Exception {
        var existing = selection("loop", true);
        service.save(user, existing);
        for (String field : new String[] {"shape", "filters"}) {
            var missing = body("loop", false);
            missing.remove(field);
            reject(missing, 400);
            var nul = body("loop", false);
            nul.putNull(field);
            reject(nul, 400);
        }
        for (String key : PreferenceSelection.FILTERS) {
            var missing = body("loop", false);
            ((ObjectNode) missing.get("filters")).remove(key);
            reject(missing, 400);
            for (String invalid : new String[] {"null", "0", "1", "\"true\"", "[]", "{}"}) {
                var wrong = body("loop", false);
                ((ObjectNode) wrong.get("filters")).set(key, mapper.readTree(invalid));
                reject(wrong, 400);
            }
        }
        for (String invalid : new String[] {"null", "1", "true", "[]", "{}"}) {
            var wrong = body("loop", false);
            wrong.set("shape", mapper.readTree(invalid));
            reject(wrong, 400);
        }
        for (String invalid : new String[] {"", "LOOP", "loop ", "invalid"}) {
            reject(body(invalid, false), 422);
        }
        var extra = body("loop", false);
        extra.put("userId", other);
        reject(extra, 400);
        var extraFilter = body("loop", false);
        ((ObjectNode) extraFilter.get("filters")).put("unknown", true);
        reject(extraFilter, 400);
        for (String raw : new String[] {"[]", "null", "{}", "{", "{\"environmentTypes\":[]}"}) {
            mvc.perform(
                            put(URL).header("Authorization", SecurityTestSupport.bearer(user))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(raw))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        assertThat(service.read(user)).isEqualTo(existing);
        assertThat(count()).isEqualTo(1);
    }

    private void reject(JsonNode body, int code) throws Exception {
        mvc.perform(
                        put(URL).header("Authorization", SecurityTestSupport.bearer(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body.toString()))
                .andExpect(status().is(code))
                .andExpect(
                        jsonPath("$.code")
                                .value(code == 422 ? "INVALID_SHAPE" : "VALIDATION_ERROR"));
    }

    @Test
    void authAndOwnership() throws Exception {
        service.save(user, selection("loop", true));
        for (long id : new long[] {other, user}) {
            mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(id)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.filters.flat").value(id == user));
        }
        mvc.perform(get(URL)).andExpect(status().isUnauthorized());
        mvc.perform(
                        put(URL).contentType(MediaType.APPLICATION_JSON)
                                .content(body("loop", false).toString()))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(URL).header("Authorization", "Bearer invalid"))
                .andExpect(status().isUnauthorized());
        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE id=?", user);
        for (long id : new long[] {user, Long.MAX_VALUE}) {
            mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(id)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("FORBIDDEN"));
            mvc.perform(
                            put(URL).header("Authorization", SecurityTestSupport.bearer(id))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body("loop", false).toString()))
                    .andExpect(status().isForbidden());
        }
        assertThat(count()).isEqualTo(1);
    }

    @Test
    void noEnvironmentEndpoint() throws Exception {
        mvc.perform(
                        get("/api/v1/environments")
                                .header("Authorization", SecurityTestSupport.bearer(user)))
                .andExpect(status().isNotFound());
    }
}
