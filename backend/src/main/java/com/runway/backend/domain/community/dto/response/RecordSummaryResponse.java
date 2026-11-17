package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import java.math.BigDecimal;
import java.math.RoundingMode;

/** 심박·케이던스는 조회 시점에 작성자가 HEALTH_DATA에 동의한 경우에만 제공하며, 그 외에는 키를 생략한다. */
public record RecordSummaryResponse(
        BigDecimal distanceM,
        Integer movingDurationSec,
        BigDecimal averagePaceSecPerKm,
        @JsonInclude(JsonInclude.Include.NON_NULL) Integer averageHeartRateBpm,
        @JsonInclude(JsonInclude.Include.NON_NULL) Integer averageCadenceSpm) {

    public static RecordSummaryResponse from(SessionShareInfo session) {
        if (session == null) {
            return new RecordSummaryResponse(null, null, null, null, null);
        }
        return new RecordSummaryResponse(
                session.totalDistance(),
                session.movingDuration(),
                session.averagePace(),
                session.authorHealthConsented() ? round(session.averageHeartRate()) : null,
                session.authorHealthConsented() ? round(session.averageCadence()) : null);
    }

    private static Integer round(BigDecimal value) {
        return value == null ? null : value.setScale(0, RoundingMode.HALF_UP).intValue();
    }
}
