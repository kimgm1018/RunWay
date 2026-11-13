package com.runway.backend.domain.runningrecord.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.time.Instant;

public record RunningRecordListItemResponse(
        long id,
        Long courseId,
        Instant startedAt,
        BigDecimal totalDistance,
        Integer movingDuration,
        BigDecimal averagePace,
        Boolean goalAchieved,
        String runType,
        RunningRecordGroupResponse group,
        // S15P31E105-756 (ADR-0024): own run-route thumbnail /api/v1/images/{id}; left out until there is one.
        @JsonInclude(JsonInclude.Include.NON_NULL) String routePreviewImageUrl) {}
