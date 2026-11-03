package com.runway.backend.domain.course.dto.request;

import java.math.BigDecimal;

/**
 * {@code courses.elevation_profile}의 경사 조각 하나. AI {@code PlanGradeSegment}와 같은 필드다. 규칙은 courses.md
 * C03 elevationProfile 절을 따른다.
 *
 * @param gradePercent 조각 경사(%). 오르막 양수
 */
public record GradeSegment(
        BigDecimal startDistanceM, BigDecimal endDistanceM, BigDecimal gradePercent) {}
