package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;
import java.util.List;

/**
 * G10 실시간 순위·앞뒤 격차 응답. 순위 대상이 아닌 참가자의 rank·gap·progressM은 null이며 stale=true다. 위치·건강 원본은 담지 않는다.
 */
public record GroupRunLiveResponse(
        long groupRunId,
        String status,
        Integer groupGuidePaceSecPerKm,
        Long courseId,
        Instant updatedAt,
        List<Participant> participants) {

    public record Participant(
            long userId,
            Integer rank,
            Integer aheadCount,
            Integer behindCount,
            Double gapToAheadM,
            Double gapToBehindM,
            Double progressM,
            Instant measuredAt,
            boolean stale) {}
}
