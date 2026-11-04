package com.runway.backend.domain.course.recommend;

import com.runway.backend.domain.course.dto.response.RecommendCoursesResponse;

/** 코스 추천 엔진(Route) 호출 포트. 실연동 전 스텁 구현 사용. */
public interface CourseRecommendPort {

    RecommendCoursesResponse recommend(CourseRecommendCommand command);
}
