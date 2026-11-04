package com.runway.backend.domain.session.service;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * S06 END 확정이 커밋된 뒤 종료 후 분석을 전용 실행기에 넘긴다. 롤백된 END에는 반응하지 않는다.
 *
 * <p>여기서는 DB를 쓰지 않고 바로 돌아온다. AFTER_COMMIT 단계의 예외는 이미 커밋된 END 응답을 실패로 만들 수 있으므로 모두 삼키고 로그만 남긴다. 이벤트는
 * 재전달되지 않는다.
 */
@Component
@RequiredArgsConstructor
public class PostRunAnalysisListener {

    private static final Logger log = LoggerFactory.getLogger(PostRunAnalysisListener.class);

    private final PostRunAnalysisDispatcher dispatcher;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPersonalSessionEnded(PersonalSessionEndedEvent event) {
        try {
            dispatcher.dispatch(event.sessionId());
        } catch (RuntimeException e) {
            log.error(
                    "종료 후 분석 요청 실패 (sessionId={}, {})",
                    event.sessionId(),
                    e.getClass().getSimpleName());
        }
    }
}
