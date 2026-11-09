package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 254 AC-5·AC-6, 550 AC-1~AC-5·AC-11. R02가 본인의 가장 늦은 날짜 결과만 반환하고, 조회가 평가를 실행하지 않으며, 오류 코드를 구분하는지,
 * 기준일 건강 지표를 본인 같은 날짜 행에서만 반환하는지 확인한다.
 */
@Testcontainers
class ReadinessLatestApiIntegrationTest extends ReadinessIntegrationSupport {

    private static final LocalDate DAY = LocalDate.of(2026, 10, 30);

    @Autowired private ReadinessJdbcRepository repository;

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

    @Test
    void 기준일의_본인_건강_지표를_함께_반환한다() throws Exception {
        insertReadiness(userId, DAY, "75.50", "LOW");
        insertHealth(userId, DAY, "58.40", "432.00");
        insertHealth(userId, DAY.minusDays(1), "70.00", "300.00");
        OffsetDateTime updatedAt =
                jdbc.queryForObject(
                        "SELECT updated_at FROM daily_health_metrics WHERE user_id=? AND metric_date=?",
                        OffsetDateTime.class,
                        userId,
                        DAY);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restingHrBpm").value(58.40))
                .andExpect(jsonPath("$.sleepDurationMin").value(432.00))
                .andExpect(jsonPath("$.healthUpdatedAt").value(updatedAt.toInstant().toString()));
    }

    @Test
    void 기준일_건강_행이_없으면_지표_키를_null로_포함한다() throws Exception {
        insertReadiness(userId, DAY, "75.50", "LOW");
        // 다른 날짜 값으로 대체하지 않는다.
        insertHealth(userId, DAY.minusDays(1), "70.00", "300.00");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasKey("restingHrBpm")))
                .andExpect(jsonPath("$.restingHrBpm", nullValue()))
                .andExpect(jsonPath("$", hasKey("sleepDurationMin")))
                .andExpect(jsonPath("$.sleepDurationMin", nullValue()))
                .andExpect(jsonPath("$", hasKey("healthUpdatedAt")))
                .andExpect(jsonPath("$.healthUpdatedAt", nullValue()));
    }

    @Test
    void 일부_지표만_있으면_없는_지표만_null이다() throws Exception {
        insertReadiness(userId, DAY, "75.50", "LOW");
        insertHealth(userId, DAY, "58", null);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restingHrBpm").value(58))
                .andExpect(jsonPath("$", hasKey("sleepDurationMin")))
                .andExpect(jsonPath("$.sleepDurationMin", nullValue()))
                .andExpect(jsonPath("$.healthUpdatedAt").isString());
    }

    /** S15P31E105-600 AC-6. 안정 심박 출처를 같은 행의 rhr_source로 반환한다. */
    @Test
    void 안정_심박_출처를_함께_반환한다() throws Exception {
        insertReadiness(userId, DAY, "75.50", "LOW");
        insertRestingHrWithSource(userId, DAY, "57.30", "SAMSUNG_HEALTH");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restingHrBpm").value(57.30))
                .andExpect(jsonPath("$.restingHrSource").value("SAMSUNG_HEALTH"));

        jdbc.update(
                "UPDATE daily_health_metrics SET rhr_source='RUNWAY_WATCH', rhr_revision=1"
                        + " WHERE user_id=?",
                userId);
        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$.restingHrSource").value("RUNWAY_WATCH"));
    }

    @Test
    void 안정_심박이_없거나_출처가_없으면_출처는_null로_포함한다() throws Exception {
        insertReadiness(userId, DAY, "75.50", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$", hasKey("restingHrSource")))
                .andExpect(jsonPath("$.restingHrSource", nullValue()));

        insertHealth(userId, DAY, "58", null);
        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$.restingHrBpm").value(58))
                .andExpect(jsonPath("$", hasKey("restingHrSource")))
                .andExpect(jsonPath("$.restingHrSource", nullValue()));

        // 짝 CHECK가 없으므로 값 없이 출처만 남은 행도 출처를 반환하지 않는다(리뷰 A-7).
        jdbc.update(
                "UPDATE daily_health_metrics SET rhr_bpm=NULL, rhr_revision=NULL,"
                        + " rhr_source='SAMSUNG_HEALTH' WHERE user_id=?",
                userId);
        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$.restingHrBpm", nullValue()))
                .andExpect(jsonPath("$.restingHrSource", nullValue()));
    }

    @Test
    void 다른_회원의_같은_날짜_건강_지표는_반환하지_않는다() throws Exception {
        insertReadiness(userId, DAY, "75.50", "LOW");
        insertReadiness(otherUserId, DAY, "40.00", "LOW");
        insertHealth(otherUserId, DAY, "99.00", "120.00");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restingHrBpm", nullValue()))
                .andExpect(jsonPath("$.sleepDurationMin", nullValue()))
                .andExpect(jsonPath("$.healthUpdatedAt", nullValue()));
    }

    @Test
    void 건강정보_동의가_없으면_건강_지표도_반환하지_않는다() throws Exception {
        insertReadiness(userId, DAY, "75.00", "LOW");
        insertHealth(userId, DAY, "58.00", "432.00");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"))
                .andExpect(jsonPath("$.restingHrBpm").doesNotExist())
                .andExpect(jsonPath("$.sleepDurationMin").doesNotExist())
                .andExpect(jsonPath("$.healthUpdatedAt").doesNotExist());
        // 오류 본문에는 원래 이 키들이 없으므로, 동의 확인 뒤 결과·건강 행 조회 자체를 하지 않는지 확인한다.
        verify(repository, never()).findLatest(anyLong());
    }

    @Test
    void 동의_확인_직후_철회가_커밋되면_점수와_건강_지표를_반환하지_않고_403() throws Exception {
        insertReadiness(userId, DAY, "75.00", "LOW");
        insertHealth(userId, DAY, "58.00", "432.00");
        // 첫 동의 확인은 철회 커밋 전 값을 읽고, 결과 조회 시점에는 철회가 커밋된 상황을 만든다.
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);
        doReturn(Optional.of(true))
                .doCallRealMethod()
                .when(repository)
                .findActiveUserConsent(userId);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"))
                .andExpect(jsonPath("$.readinessScore").doesNotExist())
                .andExpect(jsonPath("$.restingHrBpm").doesNotExist());
        // 스텁으로 첫 확인을 통과해 결과 조회까지 간 뒤, 재확인에서 403이 났는지 확인한다.
        verify(repository).findLatest(userId);
        verify(repository, times(2)).findActiveUserConsent(userId);
    }

    @Test
    void 동의_확인_직후_탈퇴가_커밋되면_401() throws Exception {
        insertReadiness(userId, DAY, "75.00", "LOW");
        insertHealth(userId, DAY, "58.00", "432.00");
        // 동의는 유지된 채 계정 상태만 바뀐 경우로 findLatest의 활성 회원 조건을 따로 확인한다.
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);
        doReturn(Optional.of(true))
                .doCallRealMethod()
                .when(repository)
                .findActiveUserConsent(userId);

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.readinessScore").doesNotExist())
                .andExpect(jsonPath("$.restingHrBpm").doesNotExist());
        verify(repository).findLatest(userId);
        verify(repository, times(2)).findActiveUserConsent(userId);
    }

    @Test
    void 탈퇴한_회원이면_동의가_남아도_결과_조회_SQL이_행을_반환하지_않는다() {
        insertReadiness(userId, DAY, "75.00", "LOW");
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);

        assertThat(repository.findLatest(userId)).isEmpty();
    }

    @Test
    void 동의가_없으면_결과_조회_SQL이_행을_반환하지_않는다() {
        insertReadiness(userId, DAY, "75.00", "LOW");
        insertHealth(userId, DAY, "58.00", "432.00");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        assertThat(repository.findLatest(userId)).isEmpty();
    }

    @Test
    void 동의_확인_후_결과가_없고_동의도_유지되면_404() throws Exception {
        // 결과가 없을 때 동의를 다시 확인해도 404 판정은 그대로다.
        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ASSESSMENT_NOT_FOUND"));
    }
}
