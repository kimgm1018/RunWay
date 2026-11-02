package com.runway.backend.domain.session.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** S01·S02·S08의 전체 세션 상태. 값이 없어도 키는 항상 포함한다. coaching은 P07 업무에서 필드를 정하기 전까지 null이다. */
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
        Object coaching,
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
