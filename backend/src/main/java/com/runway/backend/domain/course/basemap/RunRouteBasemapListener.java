package com.runway.backend.domain.course.basemap;

import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 개인 세션 종료가 커밋된 뒤 기록 경로 썸네일 생성을 전용 실행기에 넘긴다(S15P31E105-756, ADR-0024). 롤백된 종료에는 반응하지 않는다.
 *
 * <p>여기서는 DB·HTTP를 쓰지 않고 바로 돌아온다. AFTER_COMMIT 단계의 예외는 이미 커밋된 종료 결과 응답을 실패로 만들 수 있으므로 모두 삼키고
 * 로그만 남긴다.
 */
@Component
@RequiredArgsConstructor
public class RunRouteBasemapListener {

    private static final Logger log = LoggerFactory.getLogger(RunRouteBasemapListener.class);

    private final CourseBasemapDispatcher dispatcher;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPersonalSessionEnded(PersonalSessionEndedEvent event) {
        try {
            dispatcher.dispatchRun(event.sessionId());
        } catch (RuntimeException e) {
            log.error(
                    "기록 썸네일 생성 요청 실패 (sessionId={}, {})",
                    event.sessionId(),
                    e.getClass().getSimpleName());
        }
    }
}
