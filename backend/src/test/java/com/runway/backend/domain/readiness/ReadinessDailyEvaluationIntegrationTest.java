package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import com.runway.backend.domain.readiness.service.ReadinessDailyEvaluationJob;
import com.runway.backend.domain.readiness.service.ReadinessEvaluationService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 836 AC-3·AC-4. 오늘 건강 행이 없어도 정기 평가가 최근 수면·부하로 KST 오늘 준비도를 저장하고, 계산할 값·동의·활성 조건이 맞지 않는 회원은 저장하지
 * 않는다. 테스트 설정은 타이머 실행을 끄므로 작업을 직접 만들어 호출한다. 건강값은 합성 데이터다.
 */
@Testcontainers
class ReadinessDailyEvaluationIntegrationTest extends ReadinessIntegrationSupport {

    @Autowired private ReadinessJdbcRepository repository;
    @Autowired private ReadinessEvaluationService evaluationService;

    private ReadinessDailyEvaluationJob job;
    private LocalDate today;

    @BeforeEach
    void setUpJob() {
        job = new ReadinessDailyEvaluationJob(repository, evaluationService);
        today = evaluationService.today();
    }

    private void insertLoad(long user, LocalDate date, String load) {
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,daily_training_load) VALUES (?,?,?)",
                user,
                date,
                new BigDecimal(load));
    }

    @Test
    void 오늘_행이_없어도_최근_수면과_부하로_오늘을_평가한다() throws Exception {
        insertHealth(userId, today.minusDays(2), null, "420");
        insertLoad(userId, today.minusDays(1), "100");

        assertThat(job.evaluateToday()).isEqualTo(1);

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().get("readiness_date").toString()).isEqualTo(today.toString());
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM daily_health_metrics WHERE user_id=? AND metric_date=?",
                        Integer.class,
                        userId,
                        today))
                .isZero();
        mockMvc.perform(latestRequest(userId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readinessDate").value(today.toString()))
                .andExpect(jsonPath("$.readinessScore", notNullValue()))
                .andExpect(jsonPath("$.sleepScore", notNullValue()))
                .andExpect(jsonPath("$.loadScore", notNullValue()))
                .andExpect(jsonPath("$.weeklyTrainingLoad").value(100.0));
    }

    @Test
    void 부하만_있어도_27일_전까지는_대상이다() {
        insertLoad(userId, today.minusDays(27), "80");
        insertLoad(otherUserId, today.minusDays(28), "80");

        job.evaluateToday();

        assertThat(readinessRows(userId)).hasSize(1);
        assertThat(readinessRows(otherUserId)).isEmpty();
    }

    @Test
    void 계산할_값이나_동의_활성_조건이_없으면_저장하지_않는다() {
        // (a) RHR만 있는 회원: 오늘 RHR이 없으면 R을 계산할 수 없다
        insertBaseline(userId, today, 7, "60");
        // (b) 동의 철회 회원
        long disagreed = insertUser("DISAGREE");
        insertHealth(disagreed, today.minusDays(1), null, "420");
        // (c) 탈퇴 회원
        long withdrawn = insertUser("AGREE");
        insertHealth(withdrawn, today.minusDays(1), null, "420");
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                withdrawn);
        // (d) 수면이 산식 범위(D-2~D) 밖에만 있는 회원
        insertHealth(otherUserId, today.minusDays(3), null, "420");

        // 대상 조회 단계에서 빠진다(평가 단계의 동의·활성 재확인에만 기대지 않는다).
        assertThat(repository.findDailyEvaluationUserIds(today)).isEmpty();
        assertThat(job.evaluateToday()).isZero();

        assertThat(readinessCount()).isZero();
    }

    @Test
    void 이미_오늘_결과가_있으면_같은_행을_갱신한다() {
        insertHealth(userId, today.minusDays(1), null, "420");
        insertReadiness(userId, today, "10.00", "LOW");
        Object id = readinessRows(userId).getFirst().get("id");

        job.evaluateToday();

        List<Map<String, Object>> rows = readinessRows(userId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().get("id")).isEqualTo(id);
        assertThat((BigDecimal) rows.getFirst().get("readiness_score")).isEqualByComparingTo("100.00");
    }
}
