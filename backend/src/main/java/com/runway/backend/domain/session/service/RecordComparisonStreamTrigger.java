package com.runway.backend.domain.session.service;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;

import lombok.RequiredArgsConstructor;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 비교 기록이 있는 세션은 W07 batch 저장이 커밋될 때마다 S10 SESSION_STATE를 보내 기록 비교를 갱신한다(sessions.md S10 "상태 전달"). 상태를
 * 바꾸지 않으므로 stateVersion은 그대로다. 구독자가 없으면 세션을 읽지 않는다.
 */
@Component
@RequiredArgsConstructor
class RecordComparisonStreamTrigger {

    private final SessionStreamRegistry streams;
    private final RunningSessionRepository sessionRepository;
    private final ApplicationEventPublisher events;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onBatchCommitted(RunningBatchCommittedEvent event) {
        long sessionId = event.sessionId();
        if (streams.subscriberCount(sessionId) == 0) {
            return;
        }
        boolean compared =
                sessionRepository
                        .findById(sessionId)
                        .filter(session -> !session.isDeleted())
                        .map(session -> session.getComparisonSessionId() != null)
                        .orElse(false);
        if (compared) {
            events.publishEvent(SessionStreamChanged.state(sessionId));
        }
    }
}
