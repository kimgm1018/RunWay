package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;

/**
 * H06 {@code previousPeriod}. 직전 동일 길이 기간의 절대값과 현재 기간 대비 차이({@code *Delta} = current −
 * previous). 페이스 델타가 계산 불가하면 {@code averagePaceSecPerKmDelta}는 null.
 */
public record RunningRecordPreviousPeriodResponse(
        long runCount,
        BigDecimal totalDistanceM,
        BigDecimal averagePaceSecPerKm,
        long runCountDelta,
        BigDecimal totalDistanceMDelta,
        BigDecimal averagePaceSecPerKmDelta) {}
