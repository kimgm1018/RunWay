package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;

public record RunningRecordDetailResponse(
        long sessionId,
        Integer targetDistanceM,
        Integer targetDurationSec,
        BigDecimal actualDistanceM,
        Integer movingDurationSec,
        Integer elapsedDurationSec,
        BigDecimal averagePaceSecPerKm,
        BigDecimal averageHeartRate,
        BigDecimal averageCadence,
        Boolean goalAchieved,
        Long courseId,
        boolean courseFromFreeRun,
        BigDecimal targetPaceSecPerKm,
        Long comparisonSessionId,
        // S15P31E105-756 (ADR-0024): own run-route thumbnail /api/v1/images/{id}, null until there is one.
        String routePreviewImageUrl) {}
