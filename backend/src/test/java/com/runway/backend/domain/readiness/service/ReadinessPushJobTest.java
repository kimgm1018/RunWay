package com.runway.backend.domain.readiness.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.Scheduled;

/** 847 AC-1. 정기 푸시의 회원별 실패 격리, 실행 시각, 속성에 따른 등록. */
class ReadinessPushJobTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 16);

    private final ReadinessJdbcRepository repository = mock(ReadinessJdbcRepository.class);
    private final ReadinessEvaluationService service = mock(ReadinessEvaluationService.class);
    private final ReadinessPushNotifier notifier = mock(ReadinessPushNotifier.class);
    private final ReadinessPushJob job = new ReadinessPushJob(repository, service, notifier);

    @Test
    void 한_회원이_실패해도_나머지에게_보낸다() {
        when(service.today()).thenReturn(TODAY);
        when(repository.findPushUserIds(TODAY)).thenReturn(List.of(1L, 2L, 3L));
        when(notifier.send(1L, TODAY)).thenThrow(new IllegalStateException("synthetic"));
        when(notifier.send(2L, TODAY)).thenReturn(true);
        when(notifier.send(3L, TODAY)).thenReturn(false);

        assertThat(job.sendToday()).isEqualTo(1);

        verify(notifier).send(2L, TODAY);
        verify(notifier).send(3L, TODAY);
    }

    @Test
    void 대상_조회가_실패하면_보내지_않고_끝낸다() {
        when(service.today()).thenReturn(TODAY);
        when(repository.findPushUserIds(TODAY)).thenThrow(new IllegalStateException("synthetic"));

        assertThat(job.sendToday()).isZero();
    }

    @Test
    void 매일_KST_08시에_실행한다() throws Exception {
        Scheduled scheduled = ReadinessPushJob.class.getMethod("run").getAnnotation(Scheduled.class);

        assertThat(scheduled.cron()).isEqualTo("0 0 8 * * *");
        assertThat(scheduled.zone()).isEqualTo("Asia/Seoul");
    }

    private final ApplicationContextRunner context =
            new ApplicationContextRunner()
                    .withBean(ReadinessJdbcRepository.class, () -> repository)
                    .withBean(ReadinessEvaluationService.class, () -> service)
                    .withBean(ReadinessPushNotifier.class, () -> notifier)
                    .withUserConfiguration(ReadinessPushConfiguration.class);

    @Test
    void 속성을_끄면_작업을_등록하지_않는다() {
        context.withPropertyValues("runway.readiness.push-enabled=false")
                .run(app -> assertThat(app).doesNotHaveBean(ReadinessPushJob.class));
    }

    @Test
    void 속성이_없으면_작업을_등록한다() {
        context.run(app -> assertThat(app).hasSingleBean(ReadinessPushJob.class));
    }
}
