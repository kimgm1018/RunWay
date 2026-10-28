package com.runway.backend.domain.course.dto.response;

import java.math.BigDecimal;

public record BookmarkedCourseItemResponse(
        long id,
        String regionCode,
        String status,
        Long mergedIntoCourseId,
        String myAlias,
        BigDecimal distanceM) {}
