package com.runway.backend.domain.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.user.service.HrPersonalizationRunService.Outcome;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class HrPersonalizationDispatcherTest {

    private static final Duration WAIT = Duration.ofSeconds(5);

    private final HrPersonalizationRunService runService = mock(HrPersonalizationRunService.class);
    private final HrPersonalizationDispatcher dispatcher =
            new HrPersonalizationDispatcher(runService);

    @AfterEach
    void tearDown() {
        dispatcher.destroy();
    }

    @Test
    void 세션의_회원을_찾아_개인화를_실행한다() throws InterruptedException {
        when(runService.findUserId(10L)).thenReturn(Optional.of(7L));
        when(runService.runForUser(7L)).thenReturn(Outcome.SAVED);

        dispatcher.dispatch(10L);

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        verify(runService).runForUser(7L);
    }

    @Test
    void 세션이_없으면_실행하지_않는다() throws InterruptedException {
        when(runService.findUserId(10L)).thenReturn(Optional.empty());

        dispatcher.dispatch(10L);

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        verify(runService, never()).runForUser(anyLong());
    }

    @Test
    void 실행_중_예외는_삼키고_다음_작업을_계속한다() throws InterruptedException {
        when(runService.findUserId(1L)).thenReturn(Optional.of(7L));
        when(runService.findUserId(2L)).thenReturn(Optional.of(8L));
        when(runService.runForUser(7L)).thenThrow(new IllegalStateException("db"));
        when(runService.runForUser(8L)).thenReturn(Outcome.SAVED);

        dispatcher.dispatch(1L);
        dispatcher.dispatch(2L);

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        verify(runService).runForUser(8L);
    }

    @Test
    void 같은_회원의_중복_요청은_실행_중이면_끝난_뒤_한_번만_더_실행한다() throws Exception {
        CountDownLatch firstStarted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger running = new AtomicInteger();
        AtomicInteger maxConcurrent = new AtomicInteger();
        when(runService.findUserId(anyLong())).thenReturn(Optional.of(7L));
        when(runService.runForUser(7L))
                .thenAnswer(
                        invocation -> {
                            int now = running.incrementAndGet();
                            maxConcurrent.accumulateAndGet(now, Math::max);
                            firstStarted.countDown();
                            release.await(5, TimeUnit.SECONDS);
                            running.decrementAndGet();
                            return Outcome.SAVED;
                        });

        dispatcher.dispatch(1L);
        assertThat(firstStarted.await(5, TimeUnit.SECONDS)).isTrue();
        // 실행 중인 같은 회원의 요청 3건은 하나로 합쳐진다.
        dispatcher.dispatch(2L);
        dispatcher.dispatch(3L);
        dispatcher.dispatch(4L);
        // 세 건이 모두 합쳐질 때까지 기다린 뒤 첫 실행을 끝낸다.
        verify(runService, timeout(5000).times(4)).findUserId(anyLong());
        Thread.sleep(200);
        release.countDown();

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        verify(runService, times(2)).runForUser(7L);
        assertThat(maxConcurrent.get()).isEqualTo(1);
    }

    @Test
    void 서로_다른_회원은_동시에_실행할_수_있다() throws Exception {
        CountDownLatch bothRunning = new CountDownLatch(2);
        when(runService.findUserId(1L)).thenReturn(Optional.of(7L));
        when(runService.findUserId(2L)).thenReturn(Optional.of(8L));
        when(runService.runForUser(anyLong()))
                .thenAnswer(
                        invocation -> {
                            bothRunning.countDown();
                            // 두 스레드가 동시에 들어와야 통과한다.
                            assertThat(bothRunning.await(5, TimeUnit.SECONDS)).isTrue();
                            return Outcome.SAVED;
                        });

        dispatcher.dispatch(1L);
        dispatcher.dispatch(2L);

        assertThat(dispatcher.awaitIdle(WAIT)).isTrue();
        verify(runService).runForUser(7L);
        verify(runService).runForUser(8L);
    }
}
