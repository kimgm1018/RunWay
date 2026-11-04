package com.runway.backend.domain.course.recommend;

public record CourseRecommendFilters(
        boolean river,
        boolean beach,
        boolean park,
        boolean trail,
        boolean pedestrian,
        boolean avoidMajorRoad,
        boolean avoidSteps,
        boolean avoidTunnel,
        boolean flat) {

    public static CourseRecommendFilters allOff() {
        return new CourseRecommendFilters(
                false, false, false, false, false, false, false, false, false);
    }
}
