package com.runway.backend.domain.runningrecord.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;

/**
 * H06 {@code breakdown[]} 항목. period에 따라 {@code day}/{@code week}/{@code month} 중 하나만 채운다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RunningRecordStatisticsBreakdownItemResponse(
        String day, Integer week, String month, BigDecimal distanceM) {

    public static RunningRecordStatisticsBreakdownItemResponse forDay(
            String day, BigDecimal distanceM) {
        return new RunningRecordStatisticsBreakdownItemResponse(day, null, null, distanceM);
    }

    public static RunningRecordStatisticsBreakdownItemResponse forWeek(
            int week, BigDecimal distanceM) {
        return new RunningRecordStatisticsBreakdownItemResponse(null, week, null, distanceM);
    }

    public static RunningRecordStatisticsBreakdownItemResponse forMonth(
            String month, BigDecimal distanceM) {
        return new RunningRecordStatisticsBreakdownItemResponse(null, null, month, distanceM);
    }
}
