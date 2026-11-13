package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** S15P31E105-756 AC-1: 종료가 커밋된 뒤에만 기록 썸네일 생성을 넘기고, 넘기다 실패해도 종료 결과에 예외를 내지 않는다. */
class RunRouteBasemapListenerTest {

    private final CourseBasemapDispatcher dispatcher = mock(CourseBasemapDispatcher.class);
    private final RunRouteBasemapListener listener = new RunRouteBasemapListener(dispatcher);
    private final PersonalSessionEndedEvent event =
            new PersonalSessionEndedEvent(42L, null, Instant.parse("2026-03-01T11:00:00Z"));

    @Test
    void 커밋_뒤_단계에서_세션_작업을_넣는다() throws Exception {
        TransactionalEventListener annotation =
                RunRouteBasemapListener.class
                        .getMethod("onPersonalSessionEnded", PersonalSessionEndedEvent.class)
                        .getAnnotation(TransactionalEventListener.class);
        assertThat(annotation.phase()).isEqualTo(TransactionPhase.AFTER_COMMIT);

        listener.onPersonalSessionEnded(event);

        verify(dispatcher).dispatchRun(42L);
    }

    @Test
    void 실행기_오류는_삼킨다() {
        when(dispatcher.dispatchRun(anyLong())).thenThrow(new IllegalStateException("synthetic"));

        assertThatCode(() -> listener.onPersonalSessionEnded(event)).doesNotThrowAnyException();
    }
}
