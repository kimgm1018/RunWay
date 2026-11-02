package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * W06이 건강값을 저장·갱신한 날짜를 커밋 후 받아 준비도 평가를 전용 실행기에 넘긴다(devices-health.md W06 6항). 롤백된 요청에는 반응하지 않는다.
 *
 * <p>여기서는 DB를 쓰지 않고 바로 돌아온다. 평가 실패·대기열 초과는 W06 응답·저장에 영향을 주지 않는다. 이벤트는 재전달되지 않으므로 누락 복구는 후속
 * 정기 재평가 과제다.
 */
@Component
@RequiredArgsConstructor
public class ReadinessEvaluationListener {

    private final ReadinessEvaluationDispatcher dispatcher;

    @TransactionalEventListener
    public void onHealthMetricsChanged(DailyHealthMetricsChangedEvent event) {
        dispatcher.dispatch(event.userId(), event.metricDates());
    }
}
