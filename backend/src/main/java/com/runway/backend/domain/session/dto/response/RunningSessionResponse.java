package com.runway.backend.domain.session.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** S01·S02·S08의 전체 세션 상태. 값이 없어도 키는 항상 포함한다. coaching은 현재 유효한 최신 코칭이며 필드는 COACHING_GUIDE payload와 같다(sessions.md coaching 객체). */
public record RunningSessionResponse(
        long sessionId,
        Long controlDeviceId,
        Long relayDeviceId,
        String state,
        long stateVersion,
        Integer currentBpm,
        Instant startedAt,
        Instant endedAt,
        Goal goal,
        Plan plan,
        Analysis analysis,
        CoachingGuide coaching,
        Command pendingCommand,
        Command lastCommand,
        Instant serverReceiveAt,
        Instant serverSendAt,
        String recordingMode,
        Instant groupEndedAt) {

    public record Goal(
            Long courseId,
            Long comparisonSessionId,
            Integer targetDistanceM,
            Integer targetDurationSec,
            BigDecimal targetPaceSecPerKm) {}

    public record Plan(long planId, BigDecimal recommendedPaceSecPerKm, List<Segment> segments) {

        public Plan {
            segments = List.copyOf(segments);
        }
    }

    public record Segment(
            int sequence,
            BigDecimal startDistanceM,
            BigDecimal endDistanceM,
            BigDecimal recommendedPaceSecPerKm) {}

    public record Analysis(String status) {}

    public record Command(
            long commandId,
            String action,
            Integer targetBpm,
            long expectedVersion,
            Long coachingId,
            String result,
            Instant appliedAt,
            String reasonCode,
            CoachingGuide coachingGuide) {}

    public record CoachingGuide(
            long commandId,
            long coachingId,
            long expectedVersion,
            int targetBpm,
            BigDecimal recommendedPaceSecPerKm,
            Instant expiresAt) {}
}
