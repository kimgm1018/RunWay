package com.runway.backend.domain.user.service;

import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * S06 END 확정이 커밋된 뒤 심박 개인화(AI06)를 전용 실행기에 넘긴다. 롤백된 END에는 반응하지 않는다.
 *
 * <p>종료 후 분석({@code PostRunAnalysisListener})과 병렬로 동작하며 분석 READY에 의존하지 않는다. 여기서는 DB·HTTP를 쓰지 않고 바로 돌아온다.
 * AFTER_COMMIT 단계의 예외는 이미 커밋된 END 응답을 실패로 만들 수 있으므로 모두 삼키고 로그만 남긴다. 이벤트는 재전달되지 않는다.
 */
@Component
@RequiredArgsConstructor
public class HrPersonalizationListener {

    private static final Logger log = LoggerFactory.getLogger(HrPersonalizationListener.class);

    private final HrPersonalizationDispatcher dispatcher;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPersonalSessionEnded(PersonalSessionEndedEvent event) {
        try {
            dispatcher.dispatch(event.sessionId());
        } catch (RuntimeException e) {
            log.error(
                    "HR personalization 요청 실패 (sessionId={}, {})",
                    event.sessionId(),
                    e.getClass().getSimpleName());
        }
    }
}
