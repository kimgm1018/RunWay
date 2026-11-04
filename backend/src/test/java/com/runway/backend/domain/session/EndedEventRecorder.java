package com.runway.backend.domain.session;

import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** 테스트에서 @Import로 등록해 커밋 후 받은 종료 이벤트만 센다. 롤백된 트랜잭션의 이벤트는 받지 않는다. */
public class EndedEventRecorder {

    private final List<PersonalSessionEndedEvent> events = new CopyOnWriteArrayList<>();

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onEnded(PersonalSessionEndedEvent event) {
        events.add(event);
    }

    public List<PersonalSessionEndedEvent> events() {
        return List.copyOf(events);
    }

    public void clear() {
        events.clear();
    }
}
