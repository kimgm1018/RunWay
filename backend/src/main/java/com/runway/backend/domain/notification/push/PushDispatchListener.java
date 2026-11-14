package com.runway.backend.domain.notification.push;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Hands a new inbox row to the push dispatcher only after the creating transaction commits, so a rolled-back
 * action never pushes. The follow listener that calls {@code NotificationService.create} stays a plain
 * {@code @EventListener} (notifications.md); only this push step runs after commit.
 */
@Component
@RequiredArgsConstructor
public class PushDispatchListener {
    private final PushDispatcher dispatcher;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onCreated(NotificationCreatedEvent event) {
        dispatcher.dispatch(event.notificationId());
    }
}
