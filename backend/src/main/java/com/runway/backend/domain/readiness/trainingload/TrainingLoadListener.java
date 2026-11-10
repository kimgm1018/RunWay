package com.runway.backend.domain.readiness.trainingload;

import com.runway.backend.domain.session.service.RunningSessionAnalyzedEvent;
import com.runway.backend.domain.session.service.RunningSessionDeletedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 종료 후 분석이 READY로 커밋되거나 러닝이 삭제(S09) 커밋되면 러닝 부하 저장을 전용 실행기에 넘긴다(S15P31E105-599). 여기서는 DB를 쓰지 않고 바로
 * 돌아오며, 부하 저장 실패는 분석·삭제 결과에 영향을 주지 않는다(자동 재시도 없음).
 */
@Component
@RequiredArgsConstructor
public class TrainingLoadListener {

    private final TrainingLoadDispatcher dispatcher;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionAnalyzed(RunningSessionAnalyzedEvent event) {
        dispatcher.dispatch(event.sessionId());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionDeleted(RunningSessionDeletedEvent event) {
        dispatcher.dispatch(event.sessionId());
    }
}
