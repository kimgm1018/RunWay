package com.runway.backend.domain.course.dto.response;

import java.util.List;

/** C01 응답. 후보는 저장되지 않으며 notices는 생성기의 응답 전체 안내 원문이다. */
public record RecommendCoursesResponse(
        List<RecommendedCourseItemResponse> courses, List<String> notices, int nextSeed) {}
