package com.runway.backend.domain.grouprun.dto.response;

import java.util.List;

/** G14 그룹런 결과 조회. 조회만 하며 종료·분석을 실행하지 않는다. */
public record GroupRunResultsResponse(
        long groupRunId,
        Integer targetDistanceM,
        Integer targetDurationSec,
        Analysis analysis,
        boolean hasUnconfirmedStarts,
        Double distanceM,
        Integer averagePaceSecPerKm,
        Double maxGapM,
        List<Participant> participants) {

    public record Analysis(String status) {}

    public record Participant(
            long userId,
            Long sessionId,
            String startResult,
            String state,
            Analysis analysis,
            Double actualDistanceM,
            Integer movingDurationSec,
            Double averagePaceSecPerKm,
            Boolean goalAchieved) {}
}
