package com.runway.backend.domain.session.service;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

/** batch 커밋 뒤 비교 세션에만 SESSION_STATE를 보내는지(S15P31E105-422, sessions.md S10 "상태 전달"). */
class RecordComparisonStreamTriggerTest {

    private static final long SESSION_ID = 7;

    private final SessionStreamRegistry streams = mock(SessionStreamRegistry.class);
    private final RunningSessionRepository sessions = mock(RunningSessionRepository.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private RecordComparisonStreamTrigger trigger;

    @BeforeEach
    void setUp() {
        trigger = new RecordComparisonStreamTrigger(streams, sessions, events);
        when(streams.subscriberCount(SESSION_ID)).thenReturn(1);
    }

    private static RunningSession session(Long comparisonId) {
        return RunningSession.ready(
                1, 2, 3, new SessionGoal(10L, comparisonId, null, null, null), Instant.now());
    }

    @Test
    void 비교_세션의_batch가_커밋되면_SESSION_STATE를_보낸다() {
        when(sessions.findById(SESSION_ID)).thenReturn(Optional.of(session(5L)));

        trigger.onBatchCommitted(new RunningBatchCommittedEvent(SESSION_ID));

        verify(events).publishEvent(SessionStreamChanged.state(SESSION_ID));
    }

    @Test
    void 비교_기록이_없는_세션은_추가로_보내지_않는다() {
        when(sessions.findById(SESSION_ID)).thenReturn(Optional.of(session(null)));

        trigger.onBatchCommitted(new RunningBatchCommittedEvent(SESSION_ID));

        verify(events, never()).publishEvent(org.mockito.ArgumentMatchers.any(Object.class));
    }

    @Test
    void 삭제된_세션은_보내지_않는다() {
        RunningSession deleted = session(5L);
        deleted.markDeleted(Instant.now());
        when(sessions.findById(SESSION_ID)).thenReturn(Optional.of(deleted));

        trigger.onBatchCommitted(new RunningBatchCommittedEvent(SESSION_ID));

        verify(events, never()).publishEvent(org.mockito.ArgumentMatchers.any(Object.class));
    }

    @Test
    void 구독자가_없으면_세션을_읽지도_않는다() {
        when(streams.subscriberCount(SESSION_ID)).thenReturn(0);

        trigger.onBatchCommitted(new RunningBatchCommittedEvent(SESSION_ID));

        verify(sessions, never()).findById(anyLong());
        verify(events, never()).publishEvent(org.mockito.ArgumentMatchers.any(Object.class));
    }
}
