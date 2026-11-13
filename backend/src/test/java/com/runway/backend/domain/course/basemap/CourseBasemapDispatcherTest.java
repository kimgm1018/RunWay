package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.course.basemap.CourseBasemapPort.Failure;
import com.runway.backend.domain.course.basemap.CourseBasemapRunService.Outcome;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * S15P31E105-612 썸네일 실행기: 저장 이벤트 우선(A-5), 일괄 채우기 간격(B-1 완화), Route 일시 실패의 같은 실행 안 한 번 재시도(B-6).
 * Route·DB 없이 실행 결과를 정해 둔 mock 실행 서비스를 쓴다.
 */
class CourseBasemapDispatcherTest {

    private static final Duration WAIT = Duration.ofSeconds(10);

    private final List<Long> runs = new CopyOnWriteArrayList<>();
    private final List<Long> runNanos = new CopyOnWriteArrayList<>();
    private final Map<Long, List<Outcome>> scripted = new ConcurrentHashMap<>();
    private CourseBasemapDispatcher dispatcher;

    @AfterEach
    void tearDown() {
        if (dispatcher != null) {
            dispatcher.destroy();
        }
    }

    /** 실행 순서를 기록하고 코스별로 정해 둔 결과(없으면 SAVED)를 차례로 돌려주는 실행 서비스. gate가 있으면 첫 실행에서 기다린다. */
    private CourseBasemapRunService runService(CountDownLatch started, CountDownLatch gate) {
        CourseBasemapRunService service = mock(CourseBasemapRunService.class);
        when(service.run(anyLong()))
                .thenAnswer(
                        invocation -> {
                            long id = invocation.getArgument(0);
                            runs.add(id);
                            runNanos.add(System.nanoTime());
                            if (started != null) {
                                started.countDown();
                            }
                            if (gate != null) {
                                gate.await(WAIT.toSeconds(), TimeUnit.SECONDS);
                            }
                            List<Outcome> outcomes = scripted.get(id);
                            return outcomes == null || outcomes.isEmpty()
                                    ? Outcome.SAVED
                                    : outcomes.removeFirst();
                        });
        return service;
    }

    private static CourseBasemapProperties properties(Duration interval, Duration retryDelay) {
        CourseBasemapProperties properties = new CourseBasemapProperties();
        properties.setBackfillLimit(10);
        // 코스 일괄 채우기 상한만 보는 테스트들이다. 기록 작업(S15P31E105-756)은 아래 테스트가 따로 본다.
        properties.setRunBackfillLimit(0);
        properties.setBackfillInterval(interval);
        properties.setBackfillRetryDelay(retryDelay);
        return properties;
    }

    @Test
    void 기본값은_작업_간격_2초_재시도_대기_1분이다() {
        CourseBasemapProperties defaults = new CourseBasemapProperties();

        assertThat(defaults.getBackfillInterval()).isEqualTo(Duration.ofSeconds(2));
        assertThat(defaults.getBackfillRetryDelay()).isEqualTo(Duration.ofMinutes(1));
    }

    @Test
    void 저장_이벤트는_남은_일괄_채우기보다_먼저_실행한다() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch gate = new CountDownLatch(1);
        dispatcher =
                new CourseBasemapDispatcher(
                        runService(started, gate), properties(Duration.ZERO, Duration.ZERO));

        dispatcher.dispatchBackfill(1L);
        assertThat(started.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
        // 1번이 실행 중일 때 일괄 채우기 2·3번 뒤에 저장 이벤트 9번이 들어온다.
        assertThat(dispatcher.dispatchBackfill(2L)).isTrue();
        assertThat(dispatcher.dispatchBackfill(3L)).isTrue();
        assertThat(dispatcher.dispatch(9L)).isTrue();
        // 일괄 채우기로 대기 중인 코스에 저장 이벤트가 오면 앞당긴다.
        assertThat(dispatcher.dispatch(3L)).isTrue();
        gate.countDown();

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        assertThat(runs).containsExactly(1L, 9L, 3L, 2L);
    }

    @Test
    void 일괄_채우기_작업_사이에_간격을_두고_저장_이벤트는_기다리지_않는다() throws Exception {
        Duration interval = Duration.ofMillis(300);
        dispatcher =
                new CourseBasemapDispatcher(
                        runService(null, null), properties(interval, Duration.ZERO));

        dispatcher.dispatchBackfill(1L);
        dispatcher.dispatchBackfill(2L);
        dispatcher.dispatchBackfill(3L);
        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();

        assertThat(runs).containsExactly(1L, 2L, 3L);
        for (int i = 1; i < runNanos.size(); i++) {
            assertThat(Duration.ofNanos(runNanos.get(i) - runNanos.get(i - 1)))
                    .isGreaterThanOrEqualTo(interval);
        }

        // 일괄 채우기 사이 쉬는 동안 들어온 저장 이벤트는 바로 실행한다.
        dispatcher.dispatchBackfill(4L);
        long before = System.nanoTime();
        dispatcher.dispatch(8L);
        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        int saveIndex = runs.indexOf(8L);
        assertThat(runs.subList(3, runs.size())).containsExactly(8L, 4L);
        assertThat(Duration.ofNanos(runNanos.get(saveIndex) - before)).isLessThan(interval);
    }

    @Test
    void Route_일시_실패한_일괄_채우기_코스는_대기열이_빈_뒤_한_번만_다시_시도한다() throws Exception {
        scripted.put(1L, new CopyOnWriteArrayList<>(List.of(Outcome.FAILED_RETRYABLE, Outcome.SAVED)));
        // 2번은 다시 시도해도 실패한다. 세 번째 시도는 없다.
        scripted.put(
                2L,
                new CopyOnWriteArrayList<>(
                        List.of(Outcome.FAILED_RETRYABLE, Outcome.FAILED_RETRYABLE, Outcome.SAVED)));
        // 다시 시도하지 않는 실패.
        scripted.put(3L, new CopyOnWriteArrayList<>(List.of(Outcome.FAILED, Outcome.SAVED)));
        Duration retryDelay = Duration.ofMillis(200);
        dispatcher =
                new CourseBasemapDispatcher(
                        runService(null, null), properties(Duration.ZERO, retryDelay));

        for (long id = 1; id <= 4; id++) {
            dispatcher.dispatchBackfill(id);
        }
        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();

        assertThat(runs).containsExactly(1L, 2L, 3L, 4L, 1L, 2L);
        // 다시 시도는 처음 시도가 모두 끝난 뒤 재시도 대기만큼 지나서 한다.
        assertThat(Duration.ofNanos(runNanos.get(4) - runNanos.get(3)))
                .isGreaterThanOrEqualTo(retryDelay);
    }

    @Test
    void 저장_이벤트의_Route_실패는_이번_실행에서_다시_시도하지_않는다() throws Exception {
        scripted.put(5L, new CopyOnWriteArrayList<>(List.of(Outcome.FAILED_RETRYABLE, Outcome.SAVED)));
        dispatcher =
                new CourseBasemapDispatcher(
                        runService(null, null), properties(Duration.ZERO, Duration.ZERO));

        dispatcher.dispatch(5L);
        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();

        assertThat(runs).containsExactly(5L);
    }

    @Test
    void 일괄_채우기_대기열은_상한까지만_받고_같은_코스는_한_번만_받는다() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch gate = new CountDownLatch(1);
        CourseBasemapProperties properties = properties(Duration.ZERO, Duration.ZERO);
        properties.setBackfillLimit(2);
        dispatcher = new CourseBasemapDispatcher(runService(started, gate), properties);

        assertThat(dispatcher.dispatchBackfill(1L)).isTrue();
        assertThat(started.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
        assertThat(dispatcher.dispatchBackfill(1L)).isFalse();
        assertThat(dispatcher.dispatchBackfill(2L)).isTrue();
        assertThat(dispatcher.dispatchBackfill(2L)).isFalse();
        assertThat(dispatcher.dispatchBackfill(3L)).isTrue();
        assertThat(dispatcher.dispatchBackfill(4L)).isFalse();
        gate.countDown();

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        assertThat(runs).containsExactly(1L, 2L, 3L);
    }

    @Test
    void 종료하면_대기_작업을_버리고_새_작업을_받지_않는다() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch gate = new CountDownLatch(1);
        dispatcher =
                new CourseBasemapDispatcher(
                        runService(started, gate), properties(Duration.ZERO, Duration.ZERO));
        dispatcher.dispatchBackfill(1L);
        assertThat(started.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
        dispatcher.dispatchBackfill(2L);

        dispatcher.destroy();

        assertThat(dispatcher.dispatch(3L)).isFalse();
        assertThat(dispatcher.dispatchBackfill(4L)).isFalse();
        assertThat(runs).containsExactly(1L);
    }

    @Test
    void Route_일시_실패만_다시_시도_대상이다() {
        assertThat(new Failure("TIMEOUT").retryable()).isTrue();
        assertThat(new Failure("UNAVAILABLE").retryable()).isTrue();
        assertThat(new Failure("HTTP_503_BUSY").retryable()).isTrue();
        assertThat(new Failure("HTTP_503_NOT_READY").retryable()).isTrue();
        assertThat(new Failure("HTTP_500").retryable()).isTrue();
        assertThat(new Failure("HTTP_400_VALIDATION_ERROR").retryable()).isFalse();
        assertThat(new Failure("INVALID_RESPONSE").retryable()).isFalse();
        assertThat(new Failure("RESPONSE_TOO_LARGE").retryable()).isFalse();
        assertThat(new Failure("INTERRUPTED").retryable()).isFalse();
        assertThat(new Failure("NOT_CONFIGURED").retryable()).isFalse();
    }

    // --- S15P31E105-756: 러닝 기록 경로 썸네일 작업 ---

    @Test
    void 기록_작업은_같은_스레드에서_코스와_구분해_실행하고_저장_이벤트를_먼저_한다() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch gate = new CountDownLatch(1);
        List<Long> sessions = new CopyOnWriteArrayList<>();
        RunRouteBasemapRunService runRoute = mock(RunRouteBasemapRunService.class);
        when(runRoute.run(anyLong()))
                .thenAnswer(
                        invocation -> {
                            long id = invocation.getArgument(0);
                            sessions.add(id);
                            runs.add(-id);
                            return Outcome.SAVED;
                        });
        CourseBasemapProperties properties = properties(Duration.ZERO, Duration.ZERO);
        properties.setRunBackfillLimit(5);
        dispatcher = new CourseBasemapDispatcher(runService(started, gate), runRoute, properties);

        assertThat(dispatcher.dispatchBackfill(1L)).isTrue();
        assertThat(started.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
        // 같은 숫자라도 코스와 기록은 다른 작업이다.
        assertThat(dispatcher.dispatchRunBackfill(1L)).isTrue();
        assertThat(dispatcher.dispatchRunBackfill(1L)).isFalse();
        assertThat(dispatcher.dispatchRun(7L)).isTrue();
        assertThat(dispatcher.dispatchRun(7L)).isFalse();
        gate.countDown();

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        // 코스 1 실행 중에 넣은 종료 이벤트(기록 7)가 기록 일괄 채우기(기록 1)보다 먼저다.
        assertThat(runs).containsExactly(1L, -7L, -1L);
        assertThat(sessions).containsExactly(7L, 1L);
    }

    @Test
    void 일괄_채우기_상한은_코스와_기록_상한의_합이다() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch gate = new CountDownLatch(1);
        CourseBasemapProperties properties = properties(Duration.ZERO, Duration.ZERO);
        properties.setBackfillLimit(1);
        properties.setRunBackfillLimit(1);
        dispatcher =
                new CourseBasemapDispatcher(
                        runService(started, gate), mock(RunRouteBasemapRunService.class), properties);

        assertThat(dispatcher.dispatchBackfill(1L)).isTrue();
        assertThat(started.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
        assertThat(dispatcher.dispatchBackfill(2L)).isTrue();
        assertThat(dispatcher.dispatchRunBackfill(3L)).isTrue();
        assertThat(dispatcher.dispatchRunBackfill(4L)).isFalse();
        gate.countDown();
        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
    }
}
