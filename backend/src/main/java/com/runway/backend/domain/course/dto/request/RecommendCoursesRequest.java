package com.runway.backend.domain.course.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

/**
 * C01 코스 추천 요청. AI Route 입력에 맞춘 필드(페이스·TIME goal 없음).
 */
public record RecommendCoursesRequest(
        @NotNull Double latitude,
        @NotNull Double longitude,
        @NotNull Double distanceKm,
        String shape,
        Double endLatitude,
        Double endLongitude,
        @Valid RecommendCourseFilters filters,
        Integer seed) {

    /** 켜짐=해당 조건 반영. null/생략은 false(고려 안 함). */
    public record RecommendCourseFilters(
            Boolean river,
            Boolean beach,
            Boolean park,
            Boolean trail,
            Boolean pedestrian,
            Boolean avoidMajorRoad,
            Boolean avoidSteps,
            Boolean avoidTunnel,
            Boolean flat) {}
}
