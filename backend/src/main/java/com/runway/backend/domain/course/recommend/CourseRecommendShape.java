package com.runway.backend.domain.course.recommend;

public enum CourseRecommendShape {
    LOOP,
    OUT_AND_BACK,
    POINT_TO_POINT;

    public String wireValue() {
        return switch (this) {
            case LOOP -> "loop";
            case OUT_AND_BACK -> "out_and_back";
            case POINT_TO_POINT -> "point_to_point";
        };
    }
}
