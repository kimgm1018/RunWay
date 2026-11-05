package com.runway.backend.domain.course.dto.response;

/**
 * C10 응답.
 *
 * @param courseId S01에 보낼 ACTIVE 코스 ID
 * @param reused 좌표가 완전히 같은 기존 코스를 돌려줬으면 true, 새로 저장했으면 false
 */
public record SaveGeneratedCourseResponse(long courseId, boolean reused) {}
