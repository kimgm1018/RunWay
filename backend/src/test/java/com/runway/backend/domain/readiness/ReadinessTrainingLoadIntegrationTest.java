package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S15P31E105-599 AC-6·AC-7. R02의 최근 7일·평소 주간 부하(이력 보정 포함)와, W06 운동 요약으로 부하가 바뀐 날짜 이후 27일까지의 준비도
 * 재평가를 확인한다. 모든 건강 값은 합성 데이터다.
 */
@Testcontainers
class ReadinessTrainingLoadIntegrationTest extends ReadinessIntegrationSupport {

    private static final LocalDate DAY = LocalDate.of(2026, 10, 30);

    private void insertLoad(long user, LocalDate date, String load) {
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,daily_training_load) VALUES (?,?,?)",
                user,
                date,
                new BigDecimal(load));
    }

    // ---------- R02 (AC-7) ----------

    @Test
    void 최근_7일_부하와_이력_일수로_나눈_평소_주간_부하를_반환한다() throws Exception {
        insertLoad(userId, DAY.minusDays(9), "100");
        insertLoad(userId, DAY, "100");
        insertReadiness(userId, DAY, "80.00", "LOW");

        // 첫 부하 D-9 → 이력 10일, 평소 = 200 × 7 / 10 = 140
        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(100.00))
                .andExpect(jsonPath("$.usualWeeklyTrainingLoad").value(140.00));
    }

    @Test
    void 첫_부하가_28일_창보다_앞서면_28일로_나눈다() throws Exception {
        insertLoad(userId, DAY.minusDays(40), "50");
        insertLoad(userId, DAY.minusDays(20), "100");
        insertLoad(userId, DAY.minusDays(3), "100");
        insertLoad(userId, DAY.plusDays(1), "999");
        insertLoad(otherUserId, DAY, "999");
        insertReadiness(userId, DAY, "80.00", "LOW");

        // 창 D-27~D 합 200 → 평소 50, 최근 7일 100(D+1·다른 회원 값 제외)
        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(100.00))
                .andExpect(jsonPath("$.usualWeeklyTrainingLoad").value(50.00));
    }

    @Test
    void 창_안에_부하_값이_없으면_두_필드_모두_null이다() throws Exception {
        insertLoad(userId, DAY.minusDays(28), "100");
        insertReadiness(userId, DAY, "80.00", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$", hasKey("weeklyTrainingLoad")))
                .andExpect(jsonPath("$.weeklyTrainingLoad", nullValue()))
                .andExpect(jsonPath("$", hasKey("usualWeeklyTrainingLoad")))
                .andExpect(jsonPath("$.usualWeeklyTrainingLoad", nullValue()));
    }

    @Test
    void 최근_7일에_운동이_없으면_0을_반환한다() throws Exception {
        insertLoad(userId, DAY.minusDays(20), "280");
        insertReadiness(userId, DAY, "80.00", "LOW");

        // 첫 부하 D-20 → 이력 21일, 평소 = 280 × 7 / 21 = 93.33
        mockMvc.perform(latestRequest(userId))
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(0.0))
                .andExpect(jsonPath("$.usualWeeklyTrainingLoad").value(93.33));
    }

    // ---------- 날짜별 부하 (S15P31E105-639 AC-2·AC-6) ----------

    @Test
    void 날짜별_부하는_D_6부터_D까지_7개이고_운동_없는_날은_null이며_합이_주간_부하와_같다() throws Exception {
        // 원값 합 60.015 → 60.02. 각 날 HALF_UP이면 10.01+20.01+30.01 = 60.03으로 어긋난다.
        insertLoad(userId, DAY.minusDays(6), "10.0050");
        insertLoad(userId, DAY.minusDays(3), "20.0050");
        insertLoad(userId, DAY, "30.0050");
        insertLoad(userId, DAY.minusDays(7), "999");
        insertLoad(userId, DAY.plusDays(1), "999");
        insertLoad(otherUserId, DAY.minusDays(1), "999");
        // 부하 값 없는 건강 행(수면·심박만 있는 날)도 null이다.
        insertHealth(userId, DAY.minusDays(2), "60", "420");
        insertReadiness(userId, DAY, "80.00", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(60.02))
                .andExpect(jsonPath("$.dailyTrainingLoads.length()").value(7))
                .andExpect(jsonPath("$.dailyTrainingLoads[0].date").value("2026-10-24"))
                .andExpect(jsonPath("$.dailyTrainingLoads[0].load").value(10.01))
                .andExpect(jsonPath("$.dailyTrainingLoads[1].date").value("2026-10-25"))
                .andExpect(jsonPath("$.dailyTrainingLoads[1].load", nullValue()))
                .andExpect(jsonPath("$.dailyTrainingLoads[2].load", nullValue()))
                .andExpect(jsonPath("$.dailyTrainingLoads[3].date").value("2026-10-27"))
                .andExpect(jsonPath("$.dailyTrainingLoads[3].load").value(20.01))
                .andExpect(jsonPath("$.dailyTrainingLoads[4].load", nullValue()))
                .andExpect(jsonPath("$.dailyTrainingLoads[5].date").value("2026-10-29"))
                .andExpect(jsonPath("$.dailyTrainingLoads[5].load", nullValue()))
                .andExpect(jsonPath("$.dailyTrainingLoads[6].date").value("2026-10-30"))
                .andExpect(jsonPath("$.dailyTrainingLoads[6].load").value(30.00));
    }

    @Test
    void 부하_이력이_없으면_날짜별_부하는_7개_모두_null이다() throws Exception {
        insertLoad(userId, DAY.minusDays(28), "100");
        insertReadiness(userId, DAY, "80.00", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weeklyTrainingLoad", nullValue()))
                .andExpect(jsonPath("$.dailyTrainingLoads.length()").value(7))
                .andExpect(jsonPath("$.dailyTrainingLoads[0].date").value("2026-10-24"))
                .andExpect(jsonPath("$.dailyTrainingLoads[6].date").value("2026-10-30"))
                .andExpect(jsonPath("$.dailyTrainingLoads[*].load", everyItem(nullValue())));
    }

    /** 리뷰 A-4·B-4. 최근 7일에 부하가 없으면 주간 부하는 0.00이고 날짜별 부하는 7개 모두 null이다(0으로 채우지 않는다). */
    @Test
    void 최근_7일에_부하가_없으면_주간_부하는_0이고_날짜별_부하는_모두_null이다() throws Exception {
        insertLoad(userId, DAY.minusDays(20), "280");
        insertReadiness(userId, DAY, "80.00", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(0.0))
                .andExpect(jsonPath("$.dailyTrainingLoads.length()").value(7))
                .andExpect(jsonPath("$.dailyTrainingLoads[*].load", everyItem(nullValue())));
    }

    /** 리뷰 B-4. 부하 값이 0인 날(Zone1 미만 운동)은 null이 아니라 0이다. */
    @Test
    void 부하가_0인_날은_null이_아니라_0이다() throws Exception {
        insertLoad(userId, DAY.minusDays(2), "0");
        insertLoad(userId, DAY.minusDays(1), "12.5");
        insertReadiness(userId, DAY, "80.00", "LOW");

        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(12.5))
                .andExpect(jsonPath("$.dailyTrainingLoads[4].date").value("2026-10-28"))
                .andExpect(jsonPath("$.dailyTrainingLoads[4].load").value(0.0))
                .andExpect(jsonPath("$.dailyTrainingLoads[5].load").value(12.5))
                .andExpect(jsonPath("$.dailyTrainingLoads[6].load", nullValue()));
    }

    // ---------- 재평가 범위 (AC-6) ----------

    @Test
    void 운동_요약으로_부하가_바뀐_날짜_이후_27일까지_건강_행이_있는_날을_평가한다() throws Exception {
        LocalDate d = today().minusDays(25);
        insertRestingHr(userId, d.plusDays(20), "60");
        insertRestingHr(userId, d.plusDays(28), "60");
        String start = d + "T03:00:00Z";
        String exercise =
                """
                {"type":"EXERCISE_HR_SUMMARY","exerciseId":"uid-1:0","metricDate":"%s",\
                "startedAt":"%s","endedAt":"%sT03:10:00Z",\
                "heartRateSeconds":[{"bpm":150,"seconds":600}],"computedAt":"%sT03:10:00Z"}"""
                        .formatted(d, start, d, d);

        mockMvc.perform(healthRequest(userId, samsungBody(exercise)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(1));
        awaitEvaluations();

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows)
                .extracting(r -> r.get("readiness_date"))
                .containsExactly(
                        Date.valueOf(d),
                        Date.valueOf(d.plusDays(20)),
                        // S15P31E105-836: KST 오늘(d+25~26)은 건강 행이 없어도 부하 창 안이라 평가한다. d+28은 창 밖이다.
                        Date.valueOf(LocalDate.now(ZoneId.of("Asia/Seoul"))));
        // 부하 항목만 계산됐다(수면 없음, RHR 기준값 부족).
        assertThat(rows).allSatisfy(r -> assertThat(r).containsEntry("confidence", "LOW"));
    }
}
