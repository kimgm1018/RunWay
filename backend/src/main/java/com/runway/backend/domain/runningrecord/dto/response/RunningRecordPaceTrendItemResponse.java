package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;

/** H07 {@code items[]} 월별 페이스 추이. */
public record RunningRecordPaceTrendItemResponse(
        String month, BigDecimal averagePaceSecPerKm, long runCount) {}
