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
        BigDecimal targetPaceSecPerKm,
        Long comparisonSessionId) {}
