package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import com.runway.backend.global.security.SecurityTestSupport;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S15P31E105-660 AC-1~AC-7. R03이 본인의 지정 날짜 결과만 R02와 같은 형식으로 반환하고, 건강 지표·부하 창을 그 날짜 기준으로 만들며, 결과
 * 없음·미동의·비활성·형식 오류를 R02·공통 규약과 같은 코드로 응답하는지 확인한다. 모든 건강값은 합성 데이터다.
 */
@Testcontainers
class ReadinessByDateApiIntegrationTest extends ReadinessIntegrationSupport {

    private static final LocalDate EARLIER = LocalDate.of(2026, 10, 27);
    private static final LocalDate LATEST = LocalDate.of(2026, 10, 30);

    @Autowired private ReadinessJdbcRepository repository;

    private MockHttpServletRequestBuilder byDateRequest(long user, Object date) {
        return get("/api/v1/readiness-assessments/dates/" + date)
                .header("Authorization", SecurityTestSupport.bearer(user));
    }

    private void insertLoad(long user, LocalDate date, String load) {
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,daily_training_load) VALUES (?,?,?)",
                user,
                date,
                new BigDecimal(load));
    }

    private long readinessId(long user, LocalDate date) {
        return jdbc.queryForObject(
                "SELECT id FROM daily_readiness WHERE user_id=? AND readiness_date=?",
                Long.class,
                user,
                date);
    }

    @Test
    void 지정_날짜의_결과와_그_날짜_기준_지표_부하를_반환한다() throws Exception {
        insertReadiness(userId, EARLIER, "80.00", "HIGH");
        jdbc.update(
                "UPDATE daily_readiness SET sleep_score=70.00, recovery_score=85.00, load_score=90.00,"
                        + " rhr_change_pct=-1.5 WHERE user_id=? AND readiness_date=?",
                userId,
                EARLIER);
        insertReadiness(userId, LATEST, "90.00", "MEDIUM");
        insertHealth(userId, EARLIER, "60.00", "420.00");
        jdbc.update(
                "UPDATE daily_health_metrics SET rhr_source='SAMSUNG_HEALTH' WHERE user_id=? AND metric_date=?",
                userId,
                EARLIER);
        insertHealth(userId, LATEST, "55.00", "400.00");
        jdbc.update(
                "UPDATE daily_health_metrics SET rhr_source='RUNWAY_WATCH' WHERE user_id=? AND metric_date=?",
                userId,
                LATEST);
        // EARLIER 창(10-21~10-27)에는 10-22·10-25만, LATEST 창(10-24~10-30)에는 10-25·10-29가 들어간다.
        insertLoad(userId, LocalDate.of(2026, 10, 22), "100");
        insertLoad(userId, LocalDate.of(2026, 10, 25), "50");
        insertLoad(userId, LocalDate.of(2026, 10, 29), "30");
        OffsetDateTime updatedAt =
                jdbc.queryForObject(
                        "SELECT updated_at FROM daily_health_metrics WHERE user_id=? AND metric_date=?",
                        OffsetDateTime.class,
                        userId,
                        EARLIER);

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(readinessId(userId, EARLIER)))
                .andExpect(jsonPath("$.readinessScore").value(80.00))
                .andExpect(jsonPath("$.readinessDate").value("2026-10-27"))
                .andExpect(jsonPath("$.readinessConfidence").value("HIGH"))
                .andExpect(jsonPath("$.sleepScore").value(70.00))
                .andExpect(jsonPath("$.recoveryScore").value(85.00))
                .andExpect(jsonPath("$.loadScore").value(90.00))
                .andExpect(jsonPath("$.restingHrChangePct").value(-1.5))
                .andExpect(jsonPath("$.restingHrBpm").value(60.00))
                .andExpect(jsonPath("$.restingHrSource").value("SAMSUNG_HEALTH"))
                .andExpect(jsonPath("$.sleepDurationMin").value(420.00))
                .andExpect(jsonPath("$.healthUpdatedAt").value(updatedAt.toInstant().toString()))
                // 첫 부하가 10-22라 이력 6일 → 최소 7일: 150 × 7 ÷ 7.
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(150.00))
                .andExpect(jsonPath("$.usualWeeklyTrainingLoad").value(150.00))
                .andExpect(jsonPath("$.dailyTrainingLoads.length()").value(7))
                .andExpect(jsonPath("$.dailyTrainingLoads[0].date").value("2026-10-21"))
                .andExpect(jsonPath("$.dailyTrainingLoads[0].load", nullValue()))
                .andExpect(jsonPath("$.dailyTrainingLoads[1].load").value(100.00))
                .andExpect(jsonPath("$.dailyTrainingLoads[4].load").value(50.00))
                .andExpect(jsonPath("$.dailyTrainingLoads[6].date").value("2026-10-27"))
                .andExpect(jsonPath("$.readinessLevel").doesNotExist());

        // 최신 날짜도 지정해 조회할 수 있고, R02는 그대로 최신 결과다.
        mockMvc.perform(byDateRequest(userId, LATEST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readinessDate").value("2026-10-30"))
                .andExpect(jsonPath("$.restingHrBpm").value(55.00))
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(80.00));
        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readinessDate").value("2026-10-30"));
    }

    @Test
    void 그날_건강_행이_없으면_지표를_null로_포함하고_다른_날로_대체하지_않는다() throws Exception {
        insertReadiness(userId, EARLIER, "75.50", "LOW");
        insertHealth(userId, EARLIER.minusDays(1), "70.00", "300.00");
        insertHealth(userId, EARLIER.plusDays(1), "71.00", "310.00");

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasKey("restingHrBpm")))
                .andExpect(jsonPath("$.restingHrBpm", nullValue()))
                .andExpect(jsonPath("$", hasKey("restingHrSource")))
                .andExpect(jsonPath("$.restingHrSource", nullValue()))
                .andExpect(jsonPath("$", hasKey("sleepDurationMin")))
                .andExpect(jsonPath("$.sleepDurationMin", nullValue()))
                .andExpect(jsonPath("$", hasKey("healthUpdatedAt")))
                .andExpect(jsonPath("$.healthUpdatedAt", nullValue()))
                .andExpect(jsonPath("$", hasKey("weeklyTrainingLoad")))
                .andExpect(jsonPath("$.weeklyTrainingLoad", nullValue()));
    }

    @Test
    void 그_날짜_결과가_없으면_다른_날짜가_있어도_404() throws Exception {
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        insertReadiness(userId, LATEST, "80.00", "LOW");
        // 평가 가능한 건강값이 있어도 조회는 평가를 실행하지 않는다.
        insertRestingHr(userId, EARLIER.plusDays(1), "66");

        mockMvc.perform(byDateRequest(userId, EARLIER.plusDays(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ASSESSMENT_NOT_FOUND"));
        assertThat(readinessCount()).isEqualTo(2);
    }

    @Test
    void 다른_회원의_같은_날짜_결과는_반환하지_않는다() throws Exception {
        insertReadiness(otherUserId, EARLIER, "40.00", "LOW");
        insertHealth(otherUserId, EARLIER, "99.00", "120.00");

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ASSESSMENT_NOT_FOUND"))
                .andExpect(jsonPath("$.readinessScore").doesNotExist());

        // 본인 결과가 있으면 같은 날짜 다른 회원의 건강 행은 섞이지 않는다.
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readinessScore").value(75.00))
                .andExpect(jsonPath("$.restingHrBpm", nullValue()));
    }

    @Test
    void 건강정보_동의가_없으면_결과가_있어도_403이고_결과를_읽지_않는다() throws Exception {
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        insertHealth(userId, EARLIER, "58.00", "432.00");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"))
                .andExpect(jsonPath("$.readinessScore").doesNotExist())
                .andExpect(jsonPath("$.restingHrBpm").doesNotExist());
        verify(repository, never()).findByDate(anyLong(), any());
    }

    @Test
    void 탈퇴한_회원은_401() throws Exception {
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void 토큰이_없으면_401() throws Exception {
        mockMvc.perform(get("/api/v1/readiness-assessments/dates/2026-10-27"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void 동의_확인_직후_철회가_커밋되면_결과를_반환하지_않고_403() throws Exception {
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        insertHealth(userId, EARLIER, "58.00", "432.00");
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);
        doReturn(Optional.of(true))
                .doCallRealMethod()
                .when(repository)
                .findActiveUserConsent(userId);

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"))
                .andExpect(jsonPath("$.readinessScore").doesNotExist())
                .andExpect(jsonPath("$.restingHrBpm").doesNotExist());
        verify(repository).findByDate(userId, EARLIER);
        verify(repository, times(2)).findActiveUserConsent(userId);
    }

    @Test
    void 동의_확인_직후_탈퇴가_커밋되면_401() throws Exception {
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);
        doReturn(Optional.of(true))
                .doCallRealMethod()
                .when(repository)
                .findActiveUserConsent(userId);

        mockMvc.perform(byDateRequest(userId, EARLIER))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        verify(repository).findByDate(userId, EARLIER);
    }

    @Test
    void 동의가_없거나_탈퇴했으면_날짜_조회_SQL이_행을_반환하지_않는다() {
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        assertThat(repository.findByDate(userId, EARLIER)).isPresent();

        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);
        assertThat(repository.findByDate(userId, EARLIER)).isEmpty();

        jdbc.update(
                "UPDATE users SET health_data_access='AGREE', account_status='WITHDRAWN',"
                        + " withdrawn_at=now() WHERE id=?",
                userId);
        assertThat(repository.findByDate(userId, EARLIER)).isEmpty();
    }

    @Test
    void 날짜_형식이_틀리면_400_VALIDATION_ERROR() throws Exception {
        // 시간대 접미사·부호 붙은 큰 연도는 ISO 변환이 받아들이므로 따로 거절한다(리뷰 A-1·A-2·B-1·B-2).
        // +584556076-01-28은 DB 날짜 변환에서 넘쳐 2026-10-27로 바뀌므로, 그 날 결과가 있어도 400이어야 한다.
        insertReadiness(userId, EARLIER, "75.00", "LOW");
        for (String bad :
                new String[] {
                    "2026-13-01",
                    "2026-02-30",
                    "abc",
                    "20261027",
                    "2026-1-27",
                    "2026-10-27Z",
                    "2026-10-27+09:00",
                    "+2026-10-27",
                    "+584556076-01-28",
                    "+999999999-12-31",
                    "-4714-01-01",
                    " 2026-10-27"
                }) {
            mockMvc.perform(byDateRequest(userId, bad))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    // 공통 처리기의 타입 변환 실패 응답과 같은 형태다(재검토 R-1).
                    .andExpect(jsonPath("$.message").value("요청 값이 유효하지 않습니다."))
                    .andExpect(jsonPath("$.details.fields.length()").value(1))
                    .andExpect(jsonPath("$.details.fields[0].name").value("readinessDate"))
                    .andExpect(jsonPath("$.details.fields[0].reason").value("형식이 올바르지 않습니다."))
                    // 거절된 입력값은 본문 어디에도 넣지 않는다.
                    .andExpect(content().string(not(containsString(bad))));
        }
        verify(repository, never()).findByDate(anyLong(), any());
    }
}
