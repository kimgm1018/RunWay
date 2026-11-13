package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

/**
 * S15P31E105-612 기동 시 일괄 채우기의 Route 준비 대기(B-2)와 ApplicationReadyEvent 연결(A-5). Route·DB는 쓰지 않고 테스트용
 * 포트와 mock 저장소·실행기를 쓴다. 시간 값은 테스트용으로 아주 짧게 둔다.
 */
class CourseBasemapBackfillTest {

    private static final Duration WAIT = Duration.ofSeconds(5);

    private CourseBasemapRepository repository;
    private RunRouteBasemapRepository runRouteRepository;
    private CourseBasemapDispatcher dispatcher;
    private CourseBasemapBackfill backfill;

    /** 준비 상태 확인 횟수를 세고, 정해 둔 횟수째부터 준비됐다고 답하는 포트. */
    private static final class ReadinessPort implements CourseBasemapPort {
        final AtomicInteger readyChecks = new AtomicInteger();
        final AtomicReference<Thread> checkThread = new AtomicReference<>();
        final int readyFromCheck;

        /** @param readyFromCheck 이 번째(1부터) 확인부터 true. 0 이하면 끝까지 false */
        ReadinessPort(int readyFromCheck) {
            this.readyFromCheck = readyFromCheck;
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public boolean isReady() {
            checkThread.set(Thread.currentThread());
            int n = readyChecks.incrementAndGet();
            return readyFromCheck > 0 && n >= readyFromCheck;
        }

        @Override
        public BasemapResult fetch(long courseId, BasemapBbox bbox, double metersPerPixel) {
            throw new AssertionError("일괄 채우기 테스트에서는 실행기를 mock으로 둔다");
        }
    }

    private static CourseBasemapProperties properties(Duration interval, Duration waitTimeout) {
        CourseBasemapProperties properties = new CourseBasemapProperties();
        properties.setBackfillOnStartup(true);
        properties.setBackfillLimit(500);
        properties.setReadyPollInterval(interval);
        properties.setReadyWaitTimeout(waitTimeout);
        return properties;
    }

    @BeforeEach
    void setUp() {
        repository = mock(CourseBasemapRepository.class);
        runRouteRepository = mock(RunRouteBasemapRepository.class);
        dispatcher = mock(CourseBasemapDispatcher.class);
        when(repository.findActiveCourseIdsNeedingRender(anyString(), anyInt())).thenReturn(List.of(11L, 12L));
        when(dispatcher.dispatchBackfill(anyLong())).thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        if (backfill != null) {
            backfill.destroy();
        }
    }

    private Thread start(ReadinessPort port, CourseBasemapProperties properties) {
        backfill = new CourseBasemapBackfill(repository, runRouteRepository, dispatcher, port, properties);
        return backfill.start();
    }

    @Test
    void 기본값은_10초_간격_10분_대기다() {
        CourseBasemapProperties defaults = new CourseBasemapProperties();

        assertThat(defaults.getReadyPollInterval()).isEqualTo(Duration.ofSeconds(10));
        assertThat(defaults.getReadyWaitTimeout()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    void 두_번_시작해도_대기_스레드는_하나이고_대상은_한_번만_넣는다() throws Exception {
        ReadinessPort port = new ReadinessPort(1);

        Thread first = start(port, properties(Duration.ofMillis(10), Duration.ofSeconds(2)));
        Thread second = backfill.start();
        first.join(WAIT.toMillis());

        assertThat(second).isSameAs(first);
        assertThat(port.readyChecks.get()).isEqualTo(1);
        verify(repository).findActiveCourseIdsNeedingRender(CourseBasemapRunService.RENDER_VERSION, 500);
        verify(dispatcher).dispatchBackfill(11L);
    }

    @Test
    void 종료한_뒤에는_시작하지_않는다() {
        backfill = new CourseBasemapBackfill(
                repository, runRouteRepository, dispatcher, new ReadinessPort(1), properties(Duration.ofMillis(10), Duration.ofSeconds(2)));
        backfill.destroy();

        assertThat(backfill.start()).isNull();
    }

    @Test
    void 바로_준비되면_한_번_확인하고_대상을_넣는다() throws Exception {
        ReadinessPort port = new ReadinessPort(1);

        Thread thread = start(port, properties(Duration.ofMillis(10), Duration.ofSeconds(2)));
        thread.join(WAIT.toMillis());

        assertThat(thread.isAlive()).isFalse();
        assertThat(port.readyChecks.get()).isEqualTo(1);
        verify(repository).findActiveCourseIdsNeedingRender(CourseBasemapRunService.RENDER_VERSION, 500);
        verify(dispatcher).dispatchBackfill(11L);
        verify(dispatcher).dispatchBackfill(12L);
    }

    @Test
    void 준비되지_않았다가_준비되면_그_뒤에_넣는다() throws Exception {
        ReadinessPort port = new ReadinessPort(3);

        Thread thread = start(port, properties(Duration.ofMillis(10), Duration.ofSeconds(2)));
        thread.join(WAIT.toMillis());

        assertThat(thread.isAlive()).isFalse();
        assertThat(port.readyChecks.get()).isEqualTo(3);
        verify(dispatcher).dispatchBackfill(11L);
        verify(dispatcher).dispatchBackfill(12L);
    }

    @Test
    void 제한_시간_안에_준비되지_않으면_아무것도_넣지_않는다() throws Exception {
        ReadinessPort port = new ReadinessPort(0);

        long started = System.nanoTime();
        Thread thread = start(port, properties(Duration.ofMillis(20), Duration.ofMillis(150)));
        thread.join(WAIT.toMillis());
        long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();

        assertThat(thread.isAlive()).isFalse();
        assertThat(elapsedMs).isGreaterThanOrEqualTo(150);
        // 0ms부터 20ms 간격으로 150ms까지: 처음 확인 + 대기 후 확인들 + 제한 시점 확인.
        assertThat(port.readyChecks.get()).isGreaterThanOrEqualTo(3);
        verify(repository, never()).findActiveCourseIdsNeedingRender(anyString(), anyInt());
        verify(dispatcher, never()).dispatchBackfill(anyLong());
    }

    @Test
    void 기다림은_호출_스레드가_아닌_전용_데몬_스레드에서_한다() throws Exception {
        ReadinessPort port = new ReadinessPort(0);

        long started = System.nanoTime();
        Thread thread = start(port, properties(Duration.ofMillis(10), Duration.ofSeconds(30)));
        long returnedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();

        assertThat(returnedMs).isLessThan(1_000);
        assertThat(thread.isDaemon()).isTrue();
        assertThat(thread.getName()).isEqualTo(CourseBasemapBackfill.THREAD_NAME);
        verify(repository, never()).findActiveCourseIdsNeedingRender(anyString(), anyInt());

        // 종료하면 기다림을 멈추고 넣지 않는다.
        backfill.destroy();
        thread.join(WAIT.toMillis());
        assertThat(thread.isAlive()).isFalse();
        assertThat(port.checkThread.get()).isSameAs(thread);
        verify(dispatcher, never()).dispatchBackfill(anyLong());
    }

    @Test
    void 설정이_꺼져_있으면_스레드를_만들지_않는다() {
        ReadinessPort port = new ReadinessPort(1);
        CourseBasemapProperties off = properties(Duration.ofMillis(10), Duration.ofSeconds(1));
        off.setBackfillOnStartup(false);

        assertThat(start(port, off)).isNull();
        assertThat(port.readyChecks.get()).isZero();
    }

    @Test
    void ApplicationReadyEvent를_받으면_준비_확인_후_일괄_채우기를_한다() {
        ReadinessPort port = new ReadinessPort(2);
        CourseBasemapProperties properties = properties(Duration.ofMillis(10), Duration.ofSeconds(2));
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.registerBean(CourseBasemapRepository.class, () -> repository);
            context.registerBean(RunRouteBasemapRepository.class, () -> runRouteRepository);
            context.registerBean(CourseBasemapDispatcher.class, () -> dispatcher);
            context.registerBean(CourseBasemapPort.class, () -> port);
            context.registerBean(CourseBasemapProperties.class, () -> properties);
            context.register(CourseBasemapBackfill.class);
            context.refresh();

            context.publishEvent(
                    new ApplicationReadyEvent(
                            new SpringApplication(), new String[0], context, Duration.ZERO));

            verify(dispatcher, timeout(WAIT.toMillis())).dispatchBackfill(11L);
            verify(dispatcher, timeout(WAIT.toMillis())).dispatchBackfill(12L);
            assertThat(port.readyChecks.get()).isEqualTo(2);
            assertThat(port.checkThread.get().getName()).isEqualTo(CourseBasemapBackfill.THREAD_NAME);
        }
    }

    // S15P31E105-756 B-8: 코스 대상 조회가 실패해도 기록 썸네일은 넣고, 실패는 그대로 알린다.
    @Test
    void 코스_대상_조회가_실패해도_기록_썸네일은_넣는다() {
        when(repository.findActiveCourseIdsNeedingRender(anyString(), anyInt()))
                .thenThrow(new IllegalStateException("synthetic"));
        when(runRouteRepository.findSessionIdsNeedingRender(anyString(), anyInt()))
                .thenReturn(List.of(21L));
        when(dispatcher.dispatchRunBackfill(anyLong())).thenReturn(true);
        backfill = new CourseBasemapBackfill(
                repository, runRouteRepository, dispatcher, new ReadinessPort(1),
                properties(Duration.ofMillis(10), Duration.ofSeconds(2)));

        org.assertj.core.api.Assertions.assertThatThrownBy(backfill::submit)
                .isInstanceOf(IllegalStateException.class);
        verify(dispatcher).dispatchRunBackfill(21L);
    }
}
