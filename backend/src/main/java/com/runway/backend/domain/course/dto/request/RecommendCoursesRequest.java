package com.runway.backend.domain.course.dto.request;

import jakarta.validation.constraints.NotNull;
import java.util.List;

public record RecommendCoursesRequest(
        @NotNull Double latitude,
        @NotNull Double longitude,
        @NotNull Double targetDistanceM,
        @NotNull String goalInputType,
        Double targetDurationSec,
        Double targetPaceSecPerKm,
        List<String> environmentTypes,
        Double radiusM,
        Integer limit) {}
