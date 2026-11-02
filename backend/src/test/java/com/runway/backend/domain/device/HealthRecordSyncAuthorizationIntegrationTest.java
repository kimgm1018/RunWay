package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.testcontainers.junit.jupiter.Testcontainers;

/** W06 AC-5·AC-6. 인증·활성 회원·건강정보 동의가 없으면 어떤 레코드도 저장하지 않는다. */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class HealthRecordSyncAuthorizationIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Test
    void 토큰이_없으면_401() throws Exception {
        mockMvc.perform(
                        post("/api/v1/health-records/sync")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(healthBody(estimate(today(), 1, "58.4"))))
                .andExpect(status().isUnauthorized());
        assertThat(healthRows()).isZero();
    }

    @Test
    void 탈퇴한_회원은_401() throws Exception {
        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE id=?", userId);

        mockMvc.perform(healthRequest(userId, healthBody(estimate(today(), 1, "58.4"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 건강정보_미동의_회원은_403이고_저장하지_않는다() throws Exception {
        long disagree = insertUser("DISAGREE");

        mockMvc.perform(healthRequest(disagree, healthBody(estimate(today(), 1, "58.4"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 동의를_철회한_뒤의_재전송도_403이고_기존_값은_그대로다() throws Exception {
        String body = healthBody(estimate(today(), 1, "58.4"));
        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        mockMvc.perform(healthRequest(userId, healthBody(estimate(today(), 2, "57.0"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
        assertThat(metricRows(userId, today()).get(0)).containsEntry("rhr_revision", 1);
    }

    @Test
    void 저장은_요청한_회원의_행에만_한다() throws Exception {
        mockMvc.perform(healthRequest(userId, healthBody(estimate(today(), 1, "58.4"))))
                .andExpect(status().isOk());

        assertThat(metricRows(otherUserId, today())).isEmpty();
        assertThat(count("SELECT count(*) FROM daily_health_metrics WHERE user_id=?", userId))
                .isEqualTo(1);
    }
}
