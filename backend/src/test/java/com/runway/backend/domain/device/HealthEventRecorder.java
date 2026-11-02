package com.runway.backend.domain.device;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * W06 이벤트 테스트용 구독자. 발행 시점(published)과 커밋 후 전달(committed)을 따로 기록해, 롤백된 요청의 이벤트가 커밋 후 구독자에게 가지 않는지
 * 확인한다. 준비도 평가 구독자(254)가 따라야 할 방식을 흉내 낸다.
 *
 * <p>{@link #failOnPublish}를 켜면 발행 직후 동기 구독자가 예외를 던져 W06 트랜잭션을 롤백시킨다. 커밋 후 구독자 등록이 먼저 되도록 순서를
 * 지정해, "발행됐지만 롤백된" 경우를 만든다.
 */
class HealthEventRecorder {

    final List<DailyHealthMetricsChangedEvent> published = new CopyOnWriteArrayList<>();
    final List<DailyHealthMetricsChangedEvent> committed = new CopyOnWriteArrayList<>();
    final List<DailyHealthMetricsChangedEvent> rolledBack = new CopyOnWriteArrayList<>();
    volatile boolean failOnPublish;

    @Order(1)
    @TransactionalEventListener
    void onCommitted(DailyHealthMetricsChangedEvent event) {
        committed.add(event);
    }

    /** 커밋 후 리스너와 같은 단계에서 등록되는 롤백 기록. "등록된 뒤 롤백됐다"는 전제를 테스트가 확인하게 한다. */
    @Order(1)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    void onRolledBack(DailyHealthMetricsChangedEvent event) {
        rolledBack.add(event);
    }

    @Order(2)
    @EventListener
    void onPublished(DailyHealthMetricsChangedEvent event) {
        published.add(event);
        if (failOnPublish) {
            throw new IllegalStateException("synthetic listener failure");
        }
    }

    void clear() {
        published.clear();
        committed.clear();
        rolledBack.clear();
        failOnPublish = false;
    }
}
