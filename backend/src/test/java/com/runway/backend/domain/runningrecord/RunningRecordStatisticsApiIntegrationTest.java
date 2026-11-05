package com.runway.backend.domain.runningrecord;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.math.BigDecimal;
import java.time.YearMonth;
import java.time.ZoneId;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

class RunningRecordStatisticsApiIntegrationTest extends SharedContextIntegrationSupport {
    private static final String LOGIN_PREFIX = "rr_stats_";
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long ownerId;
    private long emptyUserId;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM running_metric_samples");
        jdbc.update("DELETE FROM running_session_splits");
        jdbc.update("DELETE FROM group_run_participants");
        jdbc.update("DELETE FROM group_runs");
        jdbc.update("DELETE FROM crew_memberships");
        jdbc.update("DELETE FROM crews WHERE name LIKE 'rr_stats_%'");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM daily_health_metrics");
        jdbc.update("DELETE FROM users WHERE login_id LIKE ?", LOGIN_PREFIX + "%");

        ownerId = insertUser(LOGIN_PREFIX + "owner", "통계소유자", "01050001001");
        emptyUserId = insertUser(LOGIN_PREFIX + "empty", "빈통계", "01050001002");
    }

    @Test
    void H06_빈통계_이전기간포함_심박존빈배열() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records/statistics")
                                .param("period", "WEEK")
                                .param("baseDate", "2026-03-04")
                                .header("Authorization", SecurityTestSupport.bearer(emptyUserId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.runCount").value(0))
                .andExpect(jsonPath("$.totalDistanceM").value(0))
                .andExpect(jsonPath("$.totalDurationSec").value(0))
                .andExpect(jsonPath("$.averagePaceSecPerKm").value(nullValue()))
                .andExpect(jsonPath("$.breakdown", hasSize(7)))
                .andExpect(jsonPath("$.breakdown[0].day").value("MON"))
                .andExpect(jsonPath("$.breakdown[0].distanceM").value(0))
                .andExpect(jsonPath("$.heartRateZones", hasSize(0)))
                .andExpect(jsonPath("$.previousPeriod.runCount").value(0))
                .andExpect(jsonPath("$.previousPeriod.runCountDelta").value(0));
    }

    @Test
    void H06_주간집계_삭제세션제외() throws Exception {
        // Week of 2026-03-02 (Mon) .. 2026-03-08 in Asia/Seoul
        insertSession(
                ownerId,
                "COMPLETED",
                "2026-03-02T01:00:00+09:00",
                new BigDecimal("1000.00"),
                300,
                new BigDecimal("300.00"),
                null);
        insertSession(
                ownerId,
                "COMPLETED",
                "2026-03-04T10:00:00+09:00",
                new BigDecimal("2000.00"),
                600,
                new BigDecimal("300.00"),
                null);
        insertSession(
                ownerId,
                "COMPLETED",
                "2026-03-04T12:00:00+09:00",
                new BigDecimal("500.00"),
                200,
                null,
                null);
        // deleted — must be excluded
        insertSession(
                ownerId,
                "COMPLETED",
                "2026-03-05T10:00:00+09:00",
                new BigDecimal("9999.00"),
                999,
                new BigDecimal("400.00"),
                "2026-03-10T00:00:00Z");
        // outside week
        insertSession(
                ownerId,
                "COMPLETED",
                "2026-03-09T01:00:00+09:00",
                new BigDecimal("7000.00"),
                700,
                new BigDecimal("350.00"),
                null);

        mockMvc.perform(
                        get("/api/v1/running-records/statistics")
                                .param("period", "WEEK")
                                .param("baseDate", "2026-03-04")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.runCount").value(3))
                .andExpect(jsonPath("$.totalDistanceM", closeTo(3500.0, 0.01)))
                .andExpect(jsonPath("$.totalDurationSec").value(1100))
                .andExpect(jsonPath("$.averagePaceSecPerKm", closeTo(300.0, 0.01)))
                .andExpect(jsonPath("$.breakdown", hasSize(7)))
                .andExpect(jsonPath("$.breakdown[0].day").value("MON"))
                .andExpect(jsonPath("$.breakdown[0].distanceM", closeTo(1000.0, 0.01)))
                .andExpect(jsonPath("$.breakdown[2].day").value("WED"))
                .andExpect(jsonPath("$.breakdown[2].distanceM", closeTo(2500.0, 0.01)));
    }

    @Test
    void H06_잘못된_period_baseDate_runType() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records/statistics")
                                .param("period", "DAY")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PERIOD"));

        mockMvc.perform(
                        get("/api/v1/running-records/statistics")
                                .param("period", "WEEK")
                                .param("baseDate", "2026-13-01")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PERIOD"));

        mockMvc.perform(
                        get("/api/v1/running-records/statistics")
                                .param("period", "WEEK")
                                .param("runType", "TEAM")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
    }

    @Test
    void H07_빈월_포함_changeSecPerKm() throws Exception {
        YearMonth current = YearMonth.now(SEOUL);
        YearMonth older = current.minusMonths(5);
        YearMonth mid = current.minusMonths(2);

        insertSession(
                ownerId,
                "COMPLETED",
                older.atDay(10).atTime(10, 0).atZone(SEOUL).toOffsetDateTime().toString(),
                new BigDecimal("1000.00"),
                400,
                new BigDecimal("400.00"),
                null);
        insertSession(
                ownerId,
                "COMPLETED",
                mid.atDay(5).atTime(10, 0).atZone(SEOUL).toOffsetDateTime().toString(),
                new BigDecimal("1000.00"),
                350,
                new BigDecimal("350.00"),
                null);

        mockMvc.perform(
                        get("/api/v1/running-records/statistics/pace-trend")
                                .param("months", "6")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(6)))
                .andExpect(jsonPath("$.items[0].month").value(older.toString()))
                .andExpect(jsonPath("$.items[0].runCount").value(1))
                .andExpect(jsonPath("$.items[0].averagePaceSecPerKm", closeTo(400.0, 0.01)))
                .andExpect(jsonPath("$.items[1].runCount").value(0))
                .andExpect(jsonPath("$.items[1].averagePaceSecPerKm").value(nullValue()))
                .andExpect(jsonPath("$.items[5].month").value(current.toString()))
                .andExpect(jsonPath("$.changeSecPerKm").value(nullValue()));

        // add pace in current month so first and last both non-null → change = last - first
        insertSession(
                ownerId,
                "COMPLETED",
                current.atDay(1).atTime(9, 0).atZone(SEOUL).toOffsetDateTime().toString(),
                new BigDecimal("1000.00"),
                300,
                new BigDecimal("300.00"),
                null);

        mockMvc.perform(
                        get("/api/v1/running-records/statistics/pace-trend")
                                .param("months", "6")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[5].runCount").value(1))
                .andExpect(jsonPath("$.changeSecPerKm", closeTo(-100.0, 0.01)));
    }

    @Test
    void H07_months_검증() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records/statistics/pace-trend")
                                .param("months", "0")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mockMvc.perform(
                        get("/api/v1/running-records/statistics/pace-trend")
                                .param("months", "25")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREEE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    private long insertSession(
            long userId,
            String status,
            String startedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace,
            String deletedAt) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(
                  user_id, status, started_at, ended_at,
                  total_distance, moving_duration, elapsed_duration,
                  average_pace, deleted_at)
                VALUES (
                  ?, ?::running_sessions_status_enum, ?::timestamptz,
                  CASE WHEN ? = 'COMPLETED' THEN ?::timestamptz + interval '1 hour' ELSE NULL END,
                  ?, ?, ?, ?, ?::timestamptz)
                RETURNING id
                """,
                Long.class,
                userId,
                status,
                startedAt,
                status,
                startedAt,
                totalDistance,
                movingDuration,
                movingDuration,
                averagePace,
                deletedAt);
    }
}
