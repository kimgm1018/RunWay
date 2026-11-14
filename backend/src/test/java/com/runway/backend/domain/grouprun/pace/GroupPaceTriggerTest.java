package com.runway.backend.domain.grouprun.pace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

class GroupPaceTriggerTest {
    @Test
    void blockedPreRunPlans_doNotOccupyLiveExecutor() throws Exception {
        var service = mock(GroupPaceService.class);
        var entered = new CountDownLatch(2);
        var release = new CountDownLatch(1);
        var live = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            release.await(5, TimeUnit.SECONDS);
            return null;
        }).when(service).evaluateStart(anyLong());
        doAnswer(invocation -> { live.countDown(); return null; })
                .when(service).evaluateRunning(3);
        when(service.groupForBatch(anyLong())).thenReturn(java.util.Optional.of(3L));
        var trigger = new GroupPaceTrigger(service);
        try {
            trigger.onGroupChanged(new GroupPaceChanged(1));
            trigger.onGroupChanged(new GroupPaceChanged(2));
            assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
            trigger.onBatch(new com.runway.backend.domain.device.service.RunningBatchCommittedEvent(8));
            assertThat(live.await(3, TimeUnit.SECONDS)).isTrue();
        } finally {
            release.countDown();
            trigger.shutdown();
        }
    }

    // ---- S15P31E105-817 기동 재계산 ----

    private static GroupPaceService backfillService(java.util.List<Long> targets, java.util.List<Long> remaining) {
        var service = mock(GroupPaceService.class);
        when(service.startBackfillTargets(100)).thenReturn(targets);
        when(service.startBackfillTargets(Integer.MAX_VALUE)).thenReturn(remaining);
        return service;
    }

    @Test
    void backfill_countsFilledSavedWithoutRatiosDiscardedAndFailed() {
        // 1 저장+비율 채움, 2 저장했지만 비율 없음(계속 대상), 3 저장 안 함, 4 예외
        var service = backfillService(java.util.List.of(1L, 2L, 3L, 4L), java.util.List.of(2L, 3L, 4L));
        when(service.evaluateStart(1)).thenReturn(true);
        when(service.evaluateStart(2)).thenReturn(true);
        when(service.evaluateStart(3)).thenReturn(false);
        when(service.evaluateStart(4)).thenThrow(new IllegalStateException("boom"));
        var trigger = new GroupPaceTrigger(service);
        try {
            assertThat(trigger.backfillStart()).isEqualTo(
                    new GroupPaceTrigger.BackfillResult(4, 1, 1, 1, 1, 3));
        } finally {
            trigger.shutdown();
        }
    }

    @Test
    void backfill_exceptionOnTheFirstOrMiddleTargetDoesNotStopTheNext() {
        var service = backfillService(java.util.List.of(1L, 2L, 3L), java.util.List.of());
        when(service.evaluateStart(1)).thenThrow(new IllegalStateException("first"));
        when(service.evaluateStart(2)).thenThrow(new IllegalStateException("middle"));
        when(service.evaluateStart(3)).thenReturn(true);
        var trigger = new GroupPaceTrigger(service);
        try {
            assertThat(trigger.backfillStart()).isEqualTo(
                    new GroupPaceTrigger.BackfillResult(3, 1, 0, 0, 2, 0));
            verify(service).evaluateStart(1);
            verify(service).evaluateStart(2);
            verify(service).evaluateStart(3);
        } finally {
            trigger.shutdown();
        }
    }

    @Test
    void backfill_skipsAGroupThatIsAlreadyBeingCalculated() throws Exception {
        var service = backfillService(java.util.List.of(1L, 2L), java.util.List.of());
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(service.evaluateStart(1)).thenAnswer(invocation -> {
            entered.countDown();
            release.await(5, TimeUnit.SECONDS);
            return true;
        });
        when(service.evaluateStart(2)).thenReturn(true);
        var trigger = new GroupPaceTrigger(service);
        try {
            trigger.onGroupChanged(new GroupPaceChanged(1));
            assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
            var result = trigger.backfillStart();
            assertThat(result.discarded()).isEqualTo(1);
            verify(service, times(1)).evaluateStart(1);
            verify(service).evaluateStart(2);
        } finally {
            release.countDown();
            trigger.shutdown();
        }
    }

    @Test
    void backfill_usesTheConfiguredLimit() {
        var service = mock(GroupPaceService.class);
        when(service.startBackfillTargets(anyInt())).thenReturn(java.util.List.of());
        var trigger = new GroupPaceTrigger(service, true, 7, java.time.Duration.ZERO);
        try {
            trigger.backfillStart();
            verify(service).startBackfillTargets(7);
        } finally {
            trigger.shutdown();
        }
    }

    @Test
    void backfill_negativeStartDelayIsTreatedAsZero() throws Exception {
        var service = mock(GroupPaceService.class);
        when(service.startBackfillTargets(anyInt())).thenReturn(java.util.List.of());
        var trigger = new GroupPaceTrigger(service, true, 100, java.time.Duration.ofSeconds(-5));
        try {
            trigger.onReady();
            verify(service, timeout(3000)).startBackfillTargets(100);
        } finally {
            trigger.shutdown();
        }
    }

    @Test
    void backfill_stopsWhenInterrupted() {
        var service = backfillService(java.util.List.of(1L, 2L), java.util.List.of());
        var trigger = new GroupPaceTrigger(service);
        try {
            Thread.currentThread().interrupt();
            var result = trigger.backfillStart();
            assertThat(result.discarded()).isEqualTo(2);
            verify(service, never()).evaluateStart(anyLong());
        } finally {
            Thread.interrupted();
            trigger.shutdown();
        }
    }

    // ApplicationReadyEvent를 실제로 publish한다. @EventListener를 지우거나 설정을 무시하면 실패한다.
    @Test
    void backfill_readyEventRunsItUnlessTurnedOff() {
        var runner = new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                .withBean(GroupPaceService.class, () -> mock(GroupPaceService.class))
                .withUserConfiguration(GroupPaceTrigger.class)
                .withPropertyValues("runway.group-pace.enabled=true",
                        "runway.group-pace.backfill-start-delay=PT0S");
        runner.run(context -> {
            var service = context.getBean(GroupPaceService.class);
            context.publishEvent(ready(context.getSourceApplicationContext()));
            verify(service, timeout(3000)).startBackfillTargets(100);
        });
        runner.withPropertyValues("runway.group-pace.backfill-on-startup=false").run(context -> {
            var service = context.getBean(GroupPaceService.class);
            context.publishEvent(ready(context.getSourceApplicationContext()));
            verify(service, after(500).never()).startBackfillTargets(anyInt());
        });
    }

    private static org.springframework.boot.context.event.ApplicationReadyEvent ready(
            org.springframework.context.ConfigurableApplicationContext context) {
        return new org.springframework.boot.context.event.ApplicationReadyEvent(
                new org.springframework.boot.SpringApplication(), new String[0], context,
                java.time.Duration.ZERO);
    }

    // 기능 플래그가 꺼져 있으면 트리거 Bean 자체가 없으므로 기동 재계산도 없다.
    @Test
    void backfill_flagOffHasNoTriggerBean_flagOnHasOne() {
        var runner = new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                .withBean(GroupPaceService.class, () -> mock(GroupPaceService.class))
                .withUserConfiguration(GroupPaceTrigger.class);
        runner.withPropertyValues("runway.group-pace.enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(GroupPaceTrigger.class));
        runner.run(context -> assertThat(context).doesNotHaveBean(GroupPaceTrigger.class));
        runner.withPropertyValues("runway.group-pace.enabled=true")
                .run(context -> assertThat(context).hasSingleBean(GroupPaceTrigger.class));
    }
}
