package com.runway.backend.domain.session.dto.response;

import com.runway.backend.domain.coaching.decide.CoachingLevel;

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
        RecordComparison comparison,
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

    /**
     * 과거 기록 대비 동일 거리 도달 시간 비교(sessions.md "기록 비교"). 비교 기록을 고르지 않은 세션은 객체 자체가 null이다. 거리·시간은
     * AVAILABLE에만 값이 있다.
     */
    public record RecordComparison(
            String status,
            Instant targetStartedAt,
            Integer distanceM,
            Integer currentElapsedSec,
            Integer pastElapsedSec) {}

    public record CoachingGuide(
            long commandId,
            long coachingId,
            long expectedVersion,
            int targetBpm,
            BigDecimal recommendedPaceSecPerKm,
            Instant expiresAt,
            CoachingLevel coachingLevel) {}
}
