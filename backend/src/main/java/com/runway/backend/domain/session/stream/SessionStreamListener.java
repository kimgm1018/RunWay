package com.runway.backend.domain.session.stream;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** 커밋된 변경만 S10 구독자에게 전달한다. 트랜잭션 밖에서 발행된 이벤트도 바로 전달한다. */
@Component
@RequiredArgsConstructor
class SessionStreamListener {

    private final SessionStreamRegistry registry;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void onChanged(SessionStreamChanged event) {
        registry.dispatch(event);
    }
}
