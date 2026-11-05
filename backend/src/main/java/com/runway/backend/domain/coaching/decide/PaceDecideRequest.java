package com.runway.backend.domain.coaching.decide;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * AI04 {@code POST /v1/pace/decide} 요청 본문(ai-service.md "AI04 Request Body"). 필드 이름이 그대로 camelCase JSON 키가 된다.
 * 값이 null인 필드도 키를 보낸다(AI는 goal의 세 키를 필수로 받는다). {@code context.bpm}·{@code hrReference}는 백엔드가 보내지
 * 않으므로 필드를 두지 않는다. 건강 측정값을 담으므로 로그에 남기지 않는다.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PaceDecideRequest(
        long elapsedSec,
        Instant sessionStartedAt,
        Long userId,
        History history,
        List<Candidate> candidates,
        Context context,
        boolean includeForecast) {

    /** 5초 간격 기록. 세 목록의 길이는 같고 마지막 칸이 t0다. 측정 못 한 칸은 null. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record History(List<Double> hrBpm, List<Double> speedMps, List<Double> gradePct) {}

    /** 후보 페이스 하나의 t0+5초 ~ t0+120초 계획(24칸). 경사를 모르면 null. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Candidate(
            BigDecimal paceSecPerKm, List<Double> futureSpeedMps, List<Double> futureGradePct) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Context(
            long sessionId,
            long stateVersion,
            String runState,
            String mode,
            Goal goal,
            BigDecimal goalPreference,
            List<PlanSegment> plan,
            BigDecimal anchorPaceSecPerKm,
            BigDecimal currentGuidePaceSecPerKm,
            long activeSec,
            double distanceM,
            Double routeProgressM,
            Instant inputAsOf,
            LastCoaching lastCoaching,
            Instant resumedAt) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Goal(
            Integer targetDistanceM, Integer targetDurationSec, BigDecimal targetPaceSecPerKm) {}

    public record PlanSegment(double startM, double endM, double ratio) {}

    public record LastCoaching(long coachingId, Instant appliedAt) {}
}
