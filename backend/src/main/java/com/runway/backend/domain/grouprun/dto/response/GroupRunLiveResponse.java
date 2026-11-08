package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;
import java.util.List;

/**
 * G10 실시간 순위·앞뒤 격차 응답. 순위 대상이 아닌 참가자의 rank·gap·progressM·paceSecPerKm은 null이며 stale=true다. 위치·건강 원본은
 * 담지 않는다. loadAlert는 RUNNING에서 앞서 달리는 참가자가 있을 때만 채운다.
 */
public record GroupRunLiveResponse(
        long groupRunId,
        String status,
        Integer groupGuidePaceSecPerKm,
        Long courseId,
        Instant updatedAt,
        LoadAlert loadAlert,
        List<Participant> participants) {

    public record Participant(
            long userId,
            Integer rank,
            Integer aheadCount,
            Integer behindCount,
            Double gapToAheadM,
            Double gapToBehindM,
            Double progressM,
            Integer paceSecPerKm,
            Instant measuredAt,
            boolean stale) {}

    /** 부담 알림. memberCount는 부담 참가자 수, nextPaceSecPerKm은 그룹이 늦출 안내 페이스. */
    public record LoadAlert(int memberCount, int nextPaceSecPerKm) {}
}
