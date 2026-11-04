package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** 254 AC-5·AC-6. R02가 본인의 가장 늦은 날짜 결과만 반환하고, 조회가 평가를 실행하지 않으며, 오류 코드를 구분하는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class ReadinessLatestApiIntegrationTest extends ReadinessIntegrationSupport {

    private static final LocalDate DAY = LocalDate.of(2026, 10, 30);

    @Test
    void 본인의_가장_늦은_날짜_결과를_반환한다() throws Exception {
        insertReadiness(userId, DAY.minusDays(1), "90.00", "HIGH");
        insertReadiness(userId, DAY, "75.50", "MEDIUM");
        insertReadiness(otherUserId, DAY.plusDays(1), "10.00", "LOW");
        long latestId =
                jdbc.queryForObject(
                        "SELECT id FROM daily_readiness WHERE user_id=? AND readiness_date=?",
                        Long.class,
                        userId,
                        DAY);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(latestId))
                .andExpect(jsonPath("$.readinessScore").value(75.50))
                .andExpect(jsonPath("$.readinessDate").value("2026-10-30"))
                .andExpect(jsonPath("$.readinessConfidence").value("MEDIUM"))
                .andExpect(jsonPath("$.readinessLevel").doesNotExist())
                .andExpect(jsonPath("$.sessionId").doesNotExist());
    }

    @Test
    void 신뢰도가_없으면_null로_포함한다() throws Exception {
        insertReadiness(userId, DAY, "75.00", null);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                // jsonPath().exists()는 null 값을 없음으로 보므로 키 존재와 null 값을 따로 확인한다.
                .andExpect(jsonPath("$", hasKey("readinessConfidence")))
                .andExpect(jsonPath("$.readinessConfidence", nullValue()));
    }

    @Test
    void 조회는_평가를_실행하지_않는다() throws Exception {
        // 평가 가능한 건강값이 있어도 결과가 없으면 404이고 행이 생기지 않는다.
        insertRestingHr(userId, DAY, "66");
        insertBaseline(userId, DAY, 7, "60");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ASSESSMENT_NOT_FOUND"));

        assertThat(readinessCount()).isZero();
    }

    @Test
    void 결과가_없으면_404() throws Exception {
        insertReadiness(otherUserId, DAY, "75.00", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ASSESSMENT_NOT_FOUND"));
    }

    @Test
    void 토큰이_없으면_401() throws Exception {
        mockMvc.perform(get("/api/v1/readiness-assessments/latest"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void 탈퇴한_회원은_401() throws Exception {
        insertReadiness(userId, DAY, "75.00", "LOW");
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void 건강정보_동의가_없으면_결과가_있어도_403() throws Exception {
        insertReadiness(userId, DAY, "75.00", "LOW");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"))
                .andExpect(jsonPath("$.readinessScore").doesNotExist());
    }
}
