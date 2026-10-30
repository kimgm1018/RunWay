package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;
import java.time.Instant;

public record RunningRecordListItemResponse(
        long id,
        Long courseId,
        Instant startedAt,
        BigDecimal totalDistance,
        Integer movingDuration,
        BigDecimal averagePace,
        Boolean goalAchieved) {}
