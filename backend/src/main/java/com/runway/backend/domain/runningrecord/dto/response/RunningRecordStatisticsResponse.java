package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;
import java.util.List;

/** H06 러닝 통계 요약 응답. */
public record RunningRecordStatisticsResponse(
        long runCount,
        BigDecimal totalDistanceM,
        long totalDurationSec,
        BigDecimal averagePaceSecPerKm,
        List<RunningRecordStatisticsBreakdownItemResponse> breakdown,
        List<RunningRecordHeartRateZoneResponse> heartRateZones,
        RunningRecordPreviousPeriodResponse previousPeriod) {}
