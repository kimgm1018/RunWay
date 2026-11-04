package com.runway.backend.domain.course.dto.response;

import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;

/** 선택 저장 전 추천 후보. DB course id 없음. */
public record RecommendedCourseItemResponse(
        int index, BigDecimal distanceM, GeoJsonLineString route) {}
