package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S15P31E105-250 AC-1~AC-6·AC-9. W04 건강정보 동의·철회와 W05 상태 조회. 회원·기록은 합성 데이터다. */
@Testcontainers
class ConsentApiIntegrationTest extends SyncBatchIntegrationSupport {

    private ResultActions change(long user, String body) throws Exception {
        return mockMvc.perform(
                post("/api/v1/consents")
                        .header("Authorization", SecurityTestSupport.bearer(user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private ResultActions health(long user, boolean granted) throws Exception {
        return change(user, "{\"consentType\":\"HEALTH_DATA\",\"granted\":" + granted + "}");
    }

    private ResultActions consentStatus(long user) throws Exception {
        return mockMvc.perform(
                get("/api/v1/consents").header("Authorization", SecurityTestSupport.bearer(user)));
    }

    private String stored(long user) {
        return jdbc.queryForObject(
                "SELECT health_data_access::text FROM users WHERE id=?", String.class, user);
    }

    @Test
    void 동의와_철회가_저장된다() throws Exception {
        long user = insertUser("DISAGREE");

        health(user, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentType").value("HEALTH_DATA"))
                .andExpect(jsonPath("$.granted").value(true));
        assertThat(stored(user)).isEqualTo("AGREE");

        health(user, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consentType").value("HEALTH_DATA"))
                .andExpect(jsonPath("$.granted").value(false));
        assertThat(stored(user)).isEqualTo("DISAGREE");
    }

    @Test
    void 같은_값_재요청은_멱등_200이다() throws Exception {
        for (boolean granted : new boolean[] {true, true, false, false}) {
            health(userId, granted)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.granted").value(granted));
            assertThat(stored(userId)).isEqualTo(granted ? "AGREE" : "DISAGREE");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"TERMS_OF_SERVICE", "PERSONAL_INFO", "LOCATION_DATA", "FOO", "health_data", ""})
    void 건강정보_외_유형은_422다(String type) throws Exception {
        change(userId, "{\"consentType\":\"" + type + "\",\"granted\":false}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_CONSENT"));
        assertThat(stored(userId)).isEqualTo("AGREE");
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "",
                "{}",
                "{\"consentType\":\"HEALTH_DATA\"}",
                "{\"granted\":false}",
                "{\"consentType\":\"HEALTH_DATA\",\"granted\":\"false\"}",
                "{\"consentType\":\"HEALTH_DATA\",\"granted\":0}",
                "{\"consentType\":\"HEALTH_DATA\",\"granted\":null}",
                "{\"consentType\":1,\"granted\":false}",
                "{\"consentType\":null,\"granted\":false}",
                "[{\"consentType\":\"HEALTH_DATA\",\"granted\":false}]",
                "{\"consentType\":\"HEALTH_DATA\",\"granted\":false",
                "{\"consentType\":\"HEALTH_DATA\",\"granted\":false} {}",
                "null",
                "{\"consentType\":\"TERMS_OF_SERVICE\",\"consentType\":\"HEALTH_DATA\",\"granted\":false}",
                "{\"consentType\":\"HEALTH_DATA\",\"granted\":true,\"granted\":false}"
            })
    void 형식_오류는_400이다(String body) throws Exception {
        change(userId, body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(stored(userId)).isEqualTo("AGREE");
    }

    @Test
    void 정의하지_않은_추가_필드는_무시한다() throws Exception {
        change(userId, "{\"consentType\":\"HEALTH_DATA\",\"granted\":false,\"policyVersion\":\"v1\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.granted").value(false));
        assertThat(stored(userId)).isEqualTo("DISAGREE");
    }

    @Test
    void JSON이_아닌_Content_Type은_415다() throws Exception {
        mockMvc.perform(
                        post("/api/v1/consents")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.TEXT_PLAIN)
                                .content("{\"consentType\":\"HEALTH_DATA\",\"granted\":false}"))
                .andExpect(status().isUnsupportedMediaType());
        assertThat(stored(userId)).isEqualTo("AGREE");
    }

    /** D-5: 값이 실제로 바뀔 때만 회원 행 updated_at을 갱신한다. 같은 값 재요청은 쓰지 않는다. */
    @Test
    void 값이_바뀔_때만_updated_at을_갱신한다() throws Exception {
        jdbc.update("UPDATE users SET updated_at = now() - interval '1 day' WHERE id=?", userId);
        java.sql.Timestamp before = updatedAt(userId);

        health(userId, true).andExpect(status().isOk());
        assertThat(updatedAt(userId)).isEqualTo(before);

        health(userId, false).andExpect(status().isOk());
        assertThat(updatedAt(userId)).isAfter(before);
    }

    private java.sql.Timestamp updatedAt(long user) {
        return jdbc.queryForObject(
                "SELECT updated_at FROM users WHERE id=?", java.sql.Timestamp.class, user);
    }

    @Test
    void 미인증_탈퇴회원은_401이다() throws Exception {
        mockMvc.perform(
                        post("/api/v1/consents")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"consentType\":\"HEALTH_DATA\",\"granted\":false}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/consents")).andExpect(status().isUnauthorized());

        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE id=?", userId);
        health(userId, false)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        health(userId, true)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        consentStatus(userId)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(stored(userId)).isEqualTo("AGREE");
    }

    @Test
    void 다른_회원_동의는_바뀌지_않는다() throws Exception {
        health(userId, false).andExpect(status().isOk());

        assertThat(stored(userId)).isEqualTo("DISAGREE");
        assertThat(stored(otherUserId)).isEqualTo("AGREE");
        consentStatus(otherUserId).andExpect(jsonPath("$.items[3].granted").value(true));
    }

    @Test
    void 상태_조회는_4종을_반환한다() throws Exception {
        long user = insertUser("DISAGREE");

        consentStatus(user)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(4))
                .andExpect(jsonPath("$.items[0].consentType").value("TERMS_OF_SERVICE"))
                .andExpect(jsonPath("$.items[0].granted").value(true))
                .andExpect(jsonPath("$.items[1].consentType").value("PERSONAL_INFO"))
                .andExpect(jsonPath("$.items[1].granted").value(true))
                .andExpect(jsonPath("$.items[2].consentType").value("LOCATION_DATA"))
                .andExpect(jsonPath("$.items[2].granted").value(true))
                .andExpect(jsonPath("$.items[3].consentType").value("HEALTH_DATA"))
                .andExpect(jsonPath("$.items[3].granted").value(false))
                .andExpect(jsonPath("$.items[3].policyVersion").doesNotExist());

        health(user, true).andExpect(status().isOk());
        consentStatus(user).andExpect(jsonPath("$.items[3].granted").value(true));
    }

    @Test
    void 철회는_기존_건강기록과_세션을_유지한다() throws Exception {
        long sessionId = runningSession();
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm,rhr_revision)"
                        + " VALUES (?,CURRENT_DATE,58.4,1)",
                userId);
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, metric(1, 142))))
                .andExpect(status().isOk());

        health(userId, false).andExpect(status().isOk());

        assertThat(count("SELECT count(*) FROM daily_health_metrics WHERE user_id=?", userId))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status::text FROM running_sessions WHERE id=? AND deleted_at IS NULL",
                                String.class,
                                sessionId))
                .isEqualTo("RUNNING");
        consentStatus(userId).andExpect(jsonPath("$.items[3].granted").value(false));
    }
}
