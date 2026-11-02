package com.runway.backend.domain.course.dto.response;

import java.math.BigDecimal;
import java.util.List;

public record RecommendedCourseItemResponse(
        long id,
        String regionCode,
        String status,
        BigDecimal distanceM,
        List<String> environmentTags,
        int estimatedDurationSec) {}
