package com.runway.backend.domain.course.basemap;

import com.runway.backend.domain.course.event.GeneratedCourseSavedEvent;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 생성 코스 저장이 커밋된 뒤 썸네일 바탕 지도 생성을 전용 실행기에 넘긴다(S15P31E105-612). 롤백된 저장에는 반응하지 않는다.
 *
 * <p>여기서는 DB·HTTP를 쓰지 않고 바로 돌아온다. AFTER_COMMIT 단계의 예외는 이미 커밋된 코스 저장 응답을 실패로 만들 수 있으므로 모두 삼키고 로그만
 * 남긴다.
 */
@Component
@RequiredArgsConstructor
public class CourseBasemapListener {

    private static final Logger log = LoggerFactory.getLogger(CourseBasemapListener.class);

    private final CourseBasemapDispatcher dispatcher;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onGeneratedCourseSaved(GeneratedCourseSavedEvent event) {
        try {
            dispatcher.dispatch(event.courseId());
        } catch (RuntimeException e) {
            log.error(
                    "바탕 지도 생성 요청 실패 (courseId={}, {})",
                    event.courseId(),
                    e.getClass().getSimpleName());
        }
    }
}
