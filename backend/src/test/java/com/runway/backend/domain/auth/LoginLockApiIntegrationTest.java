package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.LoginAttemptStore;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.concurrent.TimeUnit;

class LoginLockApiIntegrationTest extends AuthIntegrationSupport {
    @Test
    void fifthFailureLocksEvenCorrectPasswordWithoutExtendingDeadline() throws Exception {
        for (int i = 1; i <= 4; i++) {
            request("runner01", "Wrong999!", 401, "INVALID_CREDENTIALS");
            assertThat(value("runner01")).startsWith(i + ":");
            assertThat(ttl("runner01")).isBetween(86390000L, 86400000L);
        }
        request("runner01", "Wrong999!", 429, "LOGIN_LOCKED");
        String locked = value("runner01");
        assertThat(locked).startsWith("5:");
        assertThat(ttl("runner01")).isBetween(590000L, 600000L);
        request("runner01", "Runner9!", 429, "LOGIN_LOCKED");
        request("runner01", "Wrong999!", 429, "LOGIN_LOCKED");
        assertThat(value("runner01")).isEqualTo(locked);
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
    }

    @Test
    void nonexistentAndWithdrawnIdsHaveSameLimitsAndOtherIdsAreIndependent() throws Exception {
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", user);
        for (int i = 1; i <= 5; i++) {
            int status = i < 5 ? 401 : 429;
            String code = i < 5 ? "INVALID_CREDENTIALS" : "LOGIN_LOCKED";
            String missing = request("missing1", "Runner9!", status, code);
            assertThat(request("runner01", "Runner9!", status, code)).isEqualTo(missing);
        }
        request("another1", "Runner9!", 401, "INVALID_CREDENTIALS");
        assertThat(value("another1")).startsWith("1:");
        assertThat(redis.keys("runway:auth:family:*")).isEmpty();
    }

    @Test
    void successfulIssuanceResetsAndNextFailureStartsAtOne() throws Exception {
        request("runner01", "Wrong999!", 401, "INVALID_CREDENTIALS");
        request("runner01", "Runner9!", 200, null);
        assertThat(value("runner01")).isNull();
        assertThat(redis.keys("runway:auth:family:*")).hasSize(1);
        request("runner01", "Wrong999!", 401, "INVALID_CREDENTIALS");
        assertThat(value("runner01")).startsWith("1:");
    }

    @Test
    void malformedInputsAndDamagedPasswordDoNotMutateCounter() throws Exception {
        request("runner01", "Wrong999!", 401, "INVALID_CREDENTIALS");
        String before = value("runner01");
        for (String json :
                new String[] {"{", "{}", "{\"loginId\":\"runner01\",\"password\":\"short\"}"}) {
            mvc.perform(
                            post("/api/v1/auth/login")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(json))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        assertThat(value("runner01")).isEqualTo(before);
        jdbc.update("UPDATE users SET password='invalid-encoded-password' WHERE id=?", user);
        request("runner01", "Runner9!", 503, "SERVICE_UNAVAILABLE");
        assertThat(value("runner01")).isEqualTo(before);
    }

    private String request(String id, String password, int expected, String code) throws Exception {
        var result =
                mvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"loginId\":\""
                                                        + id
                                                        + "\",\"password\":\""
                                                        + password
                                                        + "\"}"))
                        .andExpect(status().is(expected))
                        .andExpect(
                                header().string(
                                                "Cache-Control",
                                                org.hamcrest.Matchers.containsString("no-store")));
        if (code != null)
            result.andExpect(jsonPath("$.code").value(code))
                    .andExpect(jsonPath("$.details").isEmpty());
        return result.andReturn().getResponse().getContentAsString();
    }

    private String value(String id) {
        return redis.opsForValue().get(LoginAttemptStore.key(id));
    }

    private long ttl(String id) {
        return redis.getExpire(LoginAttemptStore.key(id), TimeUnit.MILLISECONDS);
    }
}
