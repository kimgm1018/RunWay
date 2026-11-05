package com.runway.backend.domain.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@ExtendWith(MockitoExtension.class)
class HrPersonalizationListenerTest {

    private static final PersonalSessionEndedEvent EVENT =
            new PersonalSessionEndedEvent(42L, null, Instant.parse("2026-11-05T00:00:00Z"));

    @Mock private HrPersonalizationDispatcher dispatcher;

    @Test
    void 종료_이벤트를_받으면_세션ID로_디스패치한다() {
        new HrPersonalizationListener(dispatcher).onPersonalSessionEnded(EVENT);

        verify(dispatcher).dispatch(42L);
    }

    @Test
    void 디스패치가_실패해도_예외를_삼킨다() {
        doThrow(new IllegalStateException("boom")).when(dispatcher).dispatch(42L);

        assertThatCode(() -> new HrPersonalizationListener(dispatcher).onPersonalSessionEnded(EVENT))
                .doesNotThrowAnyException();
    }

    @Test
    void 커밋_이후에만_반응한다() throws NoSuchMethodException {
        TransactionalEventListener annotation =
                HrPersonalizationListener.class
                        .getMethod("onPersonalSessionEnded", PersonalSessionEndedEvent.class)
                        .getAnnotation(TransactionalEventListener.class);

        assertThat(annotation).isNotNull();
        assertThat(annotation.phase()).isEqualTo(TransactionPhase.AFTER_COMMIT);
    }
}
