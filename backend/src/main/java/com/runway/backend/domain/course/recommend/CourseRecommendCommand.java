package com.runway.backend.domain.course.recommend;

/** AI Route(또는 스텁)에 넘기는 검증된 추천 입력. */
public record CourseRecommendCommand(
        double latitude,
        double longitude,
        double distanceKm,
        CourseRecommendShape shape,
        Double endLatitude,
        Double endLongitude,
        CourseRecommendFilters filters,
        int seed) {}
