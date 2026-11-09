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
}
