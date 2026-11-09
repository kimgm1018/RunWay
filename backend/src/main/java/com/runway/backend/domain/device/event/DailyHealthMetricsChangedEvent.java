package com.runway.backend.domain.device.event;

import java.time.LocalDate;
import java.util.List;

/**
 * W06이 daily_health_metrics 값을 새로 저장하거나 갱신한 날짜(워치 심박은 더 큰 revision 또는 삼성 값 대체, 수면·삼성 안정 심박은
 * 다른 값, S15P31E105-572·600). 준비도 자동 평가(S15P31E105-254)가 구독한다.
 *
 * <p>W06 트랜잭션 안에서 발행한다. 구독자는 {@code @TransactionalEventListener}(기본 AFTER_COMMIT)로 받아야 커밋된 값만
 * 처리하고, 롤백된 요청에 반응하지 않는다. 같은 날짜가 다른 요청으로 다시 바뀌면 다시 발행되므로 구독자는 같은 (userId, 날짜)의 중복 수신을
 * 허용해야 한다. 건강 값은 담지 않는다.
 *
 * @param metricDates 중복 없는 오름차순 날짜. 비어 있지 않다
 */
public record DailyHealthMetricsChangedEvent(long userId, List<LocalDate> metricDates) {

    public DailyHealthMetricsChangedEvent {
        metricDates = List.copyOf(metricDates);
        if (metricDates.isEmpty()) {
            throw new IllegalArgumentException("metricDates must not be empty");
        }
    }
}
