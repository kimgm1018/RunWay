package com.runway.backend.domain.course.dto.response;

import java.util.List;

public record RecommendCoursesResponse(List<RecommendedCourseItemResponse> courses) {}
