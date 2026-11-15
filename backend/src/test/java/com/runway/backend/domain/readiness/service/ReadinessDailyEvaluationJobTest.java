package com.runway.backend.domain.readiness.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.readiness.formula.ReadinessConfidence;
import com.runway.backend.domain.readiness.formula.ReadinessScore;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.Scheduled;

/** 836 AC-5·AC-6. 정기 평가의 회원별 실패 격리와 속성에 따른 등록. */
class ReadinessDailyEvaluationJobTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 15);

    private final ReadinessJdbcRepository repository = mock(ReadinessJdbcRepository.class);
    private final ReadinessEvaluationService service = mock(ReadinessEvaluationService.class);
    private final ReadinessDailyEvaluationJob job = new ReadinessDailyEvaluationJob(repository, service);

    private static ReadinessScore score() {
        BigDecimal v = new BigDecimal("80.00");
        return new ReadinessScore(v, ReadinessConfidence.LOW, v, null, null, null);
    }

    @Test
    void 한_회원이_실패해도_나머지를_평가한다() {
        when(service.today()).thenReturn(TODAY);
        when(repository.findDailyEvaluationUserIds(TODAY)).thenReturn(List.of(1L, 2L, 3L));
        when(service.evaluate(1L, TODAY)).thenThrow(new IllegalStateException("synthetic"));
        when(service.evaluate(2L, TODAY)).thenReturn(Optional.of(score()));
        when(service.evaluate(3L, TODAY)).thenReturn(Optional.empty());

        assertThat(job.evaluateToday()).isEqualTo(1);

        verify(service).evaluate(2L, TODAY);
        verify(service).evaluate(3L, TODAY);
    }

    @Test
    void 대상_조회가_실패하면_평가하지_않고_끝낸다() {
        when(service.today()).thenReturn(TODAY);
        when(repository.findDailyEvaluationUserIds(TODAY))
                .thenThrow(new IllegalStateException("synthetic"));

        assertThat(job.evaluateToday()).isZero();
    }

    private final ApplicationContextRunner context =
            new ApplicationContextRunner()
                    .withBean(ReadinessJdbcRepository.class, () -> repository)
                    .withBean(ReadinessEvaluationService.class, () -> service)
                    .withUserConfiguration(ReadinessDailyEvaluationConfiguration.class);

    @Test
    void 속성을_끄면_작업을_등록하지_않는다() {
        context.withPropertyValues("runway.readiness.daily-evaluation-enabled=false")
                .run(app -> assertThat(app).doesNotHaveBean(ReadinessDailyEvaluationJob.class));
    }

    @Test
    void 속성이_없으면_작업을_등록한다() {
        context.run(app -> assertThat(app).hasSingleBean(ReadinessDailyEvaluationJob.class));
    }

    /** 836 AC-6. 매일 KST 00:05에 실행한다(서버 시계 UTC와 무관). */
    @Test
    void 매일_KST_00시_05분에_실행한다() throws Exception {
        Scheduled scheduled =
                ReadinessDailyEvaluationJob.class.getMethod("run").getAnnotation(Scheduled.class);

        assertThat(scheduled.cron()).isEqualTo("0 5 0 * * *");
        assertThat(scheduled.zone()).isEqualTo("Asia/Seoul");
    }
}
