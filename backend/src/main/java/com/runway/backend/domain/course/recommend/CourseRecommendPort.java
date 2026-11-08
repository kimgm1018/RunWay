package com.runway.backend.domain.course.recommend;

import java.time.Instant;

/**
 * 코스 생성기(Route) 호출 포트. 운영은 Route HTTP 어댑터, 개발자가 명시한 경우에만 스텁을 쓴다.
 * 실패하면 공개 오류({@code details.reason} 포함)의 {@link com.runway.backend.global.exception.ApiException}을
 * 던진다. 실패 시 다른 생성기로 자동 전환하지 않는다.
 */
public interface CourseRecommendPort {

    /**
     * @param deadline C01 전체 예산이 끝나는 시각. 생성기 자체 상한이 더 길어도 이 시각을 넘기지 않는다
     */
    GeneratedCourses recommend(CourseRecommendCommand command, Instant deadline);
}
