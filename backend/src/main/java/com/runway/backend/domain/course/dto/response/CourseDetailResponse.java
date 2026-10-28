package com.runway.backend.domain.course.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.math.BigDecimal;
import java.util.List;
import tools.jackson.databind.JsonNode;

public record CourseDetailResponse(
        long id,
        String myAlias,
        String description,
        GeoJsonLineString route,
        GeoJsonPoint startPosition,
        BigDecimal distanceM,
        BigDecimal elevationGainM,
        JsonNode elevationProfile,
        List<String> environmentTags,
        @JsonInclude(JsonInclude.Include.NON_NULL) Integer estimatedDurationSec,
        String status,
        Long mergedIntoCourseId) {}
