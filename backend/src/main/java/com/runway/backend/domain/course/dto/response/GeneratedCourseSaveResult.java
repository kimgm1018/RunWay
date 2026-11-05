package com.runway.backend.domain.course.dto.response;

/**
 * 생성 코스 저장 결과(서버 내부).
 *
 * @param courseId 저장 또는 재사용한 코스 ID
 * @param reused 좌표가 완전히 같은 ACTIVE 코스를 재사용했으면 true
 */
public record GeneratedCourseSaveResult(long courseId, boolean reused) {}
