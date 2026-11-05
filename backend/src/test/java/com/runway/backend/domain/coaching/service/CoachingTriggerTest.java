package com.runway.backend.domain.coaching.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.service.SessionCoachingService;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** 코칭 트리거 실행기 — 421 플랜 AC-8·AC-11(T-13). */
class CoachingTriggerTest {

    private final SessionCoachingService service = mock(SessionCoachingService.class);
    private final SessionStreamRegistry streams = mock(SessionStreamRegistry.class);
    private final CoachingTrigger trigger = new CoachingTrigger(service, streams);

    @AfterEach
    void shutdown() {
        trigger.shutdown();
    }

    @Test
    void 다른_세션은_병렬로_판단하고_같은_세션은_끝난_뒤_한_번만_다시_판단한다() throws Exception {
        when(streams.subscriberCount(anyLong())).thenReturn(1);
        CountDownLatch bothRunning = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        Map<Long, AtomicInteger> calls = new ConcurrentHashMap<>();
        when(service.issueIfDue(anyLong(), any(BooleanSupplier.class)))
                .thenAnswer(
                        invocation -> {
                            long id = invocation.getArgument(0);
                            calls.computeIfAbsent(id, k -> new AtomicInteger()).incrementAndGet();
                            bothRunning.countDown();
                            release.await(5, TimeUnit.SECONDS);
                            return Optional.empty();
                        });

        trigger.onBatchCommitted(new RunningBatchCommittedEvent(1));
        trigger.onBatchCommitted(new RunningBatchCommittedEvent(2));
        // 세션 2개가 동시에 AI 응답을 기다린다.
        assertThat(bothRunning.await(2, TimeUnit.SECONDS)).isTrue();
        // 판단 중인 세션 1에 batch가 세 번 와도 끝난 뒤 한 번만 다시 판단한다.
        trigger.onBatchCommitted(new RunningBatchCommittedEvent(1));
        trigger.onBatchCommitted(new RunningBatchCommittedEvent(1));
        trigger.onBatchCommitted(new RunningBatchCommittedEvent(1));
        assertThat(calls.get(1L).get()).isEqualTo(1);
        release.countDown();
        Thread.sleep(300);

        assertThat(calls.get(1L).get()).isEqualTo(2);
        assertThat(calls.get(2L).get()).isEqualTo(1);
    }

    @Test
    void S10_구독이_없으면_판단하지_않는다() {
        when(streams.subscriberCount(5L)).thenReturn(0);

        trigger.evaluate(5L);

        org.mockito.Mockito.verifyNoInteractions(service);
    }

    @Test
    void 세션별_AI_호출은_15초_간격으로만_허가한다() {
        assertThat(trigger.recentlyCalled(1L)).isFalse();
        assertThat(trigger.tryAcquireCall(1L)).isTrue();
        assertThat(trigger.recentlyCalled(1L)).isTrue();
        assertThat(trigger.tryAcquireCall(1L)).isFalse();
        assertThat(trigger.tryAcquireCall(2L)).isTrue();
    }

    @Test
    void 최근_15초_안에_부른_세션은_입력_조회_전에_생략한다() {
        when(streams.subscriberCount(3L)).thenReturn(1);
        trigger.tryAcquireCall(3L);

        trigger.evaluate(3L);

        org.mockito.Mockito.verifyNoInteractions(service);
    }
}
