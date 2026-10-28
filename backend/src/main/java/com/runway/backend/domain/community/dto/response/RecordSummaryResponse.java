package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import java.math.BigDecimal;

public record RecordSummaryResponse(
        BigDecimal distanceM, Integer movingDurationSec, BigDecimal averagePaceSecPerKm) {

    public static RecordSummaryResponse from(SessionShareInfo session) {
        if (session == null) {
            return new RecordSummaryResponse(null, null, null);
        }
        return new RecordSummaryResponse(
                session.totalDistance(), session.movingDuration(), session.averagePace());
    }
}
