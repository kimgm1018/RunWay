package com.runway.backend.domain.course.dto.response;

import java.math.BigDecimal;

/**
 * C09 저장 코스 한 건. {@code isPrivate}는 자유 러닝 기록으로 만든 개인 코스(courses.is_private)이며, 그룹런
 * 코스로 쓸 수 없으므로 앱이 그룹런 코스 고르기에서 제외한다(S15P31E105-696).
 */
public record BookmarkedCourseItemResponse(
        long id,
        String regionCode,
        String status,
        Long mergedIntoCourseId,
        String myAlias,
        BigDecimal distanceM,
        boolean isPrivate) {}
