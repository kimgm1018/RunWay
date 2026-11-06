package com.runway.backend.domain.image;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;

class ImageCleanupConfigurationTest {
    final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(ImageCleanupConfiguration.class, WithdrawnImageCleanupWorker.class)
            .withBean(WithdrawnImageCleanupRepository.class, () -> {
                var accounts = mock(WithdrawnImageCleanupRepository.class);
                when(accounts.maxWithdrawnId()).thenReturn(0L);
                return accounts;
            })
            .withBean(WithdrawnImageCleanup.class, () -> mock(WithdrawnImageCleanup.class));

    @Test
    void productionDefaultRegistersOnePeriodicTaskAndExplicitDisableDoesNot() {
        context.run(app -> {
            assertThat(app).hasSingleBean(WithdrawnImageCleanupWorker.class);
            assertThat(app.getBean(ScheduledAnnotationBeanPostProcessor.class).getScheduledTasks()).hasSize(1);
            org.awaitility.Awaitility.await().atMost(2, TimeUnit.SECONDS).untilAsserted(() ->
                    verify(app.getBean(WithdrawnImageCleanupRepository.class), atLeastOnce()).maxWithdrawnId());
        });
        context.withPropertyValues("runway.images.cleanup-enabled=false").run(app -> {
            assertThat(app).doesNotHaveBean(WithdrawnImageCleanupWorker.class);
            assertThat(app).doesNotHaveBean(ScheduledAnnotationBeanPostProcessor.class);
        });
    }
}
