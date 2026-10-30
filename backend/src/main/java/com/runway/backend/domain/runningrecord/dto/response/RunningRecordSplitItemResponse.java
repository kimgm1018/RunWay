package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;

public record RunningRecordSplitItemResponse(
        BigDecimal startDistanceM,
        BigDecimal endDistanceM,
        BigDecimal paceSecPerKm,
        BigDecimal averageHeartRate,
        BigDecimal averageCadence) {}
