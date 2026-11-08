package com.runway.backend.domain.coaching.decide;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * AI04 입력을 만들기 위해 DB에서 읽은 한 세션의 상태(잠금 없는 스냅샷). 건강 측정값을 담으므로 로그에 남기지 않는다.
 *
 * @param userId 건강정보 동의 사용자만 값이 있다(ai-service.md "건강정보 동의에 따른 사용자 ID 전달")
 * @param courseDistanceM 코스 러닝이면 코스 거리, 자유러닝이면 null
 * @param gradeProfile 코스의 100m 경사(courses.md elevationProfile). 코스가 아니거나 없으면 null
 * @param plan 최신 초기 계획. 없으면 null
 * @param lastAppliedCoaching 마지막으로 워치에 적용된 코칭. 없으면 null
 * @param lastResumedAt 마지막으로 적용된 재개 시각. 없으면 null
 * @param samples 최근 측정 표본(경과초 오름차순)
 */
public record CoachingSource(
        long sessionId,
        Long userId,
        long stateVersion,
        Instant startedAt,
        Integer goalDistanceM,
        Integer goalDurationSec,
        BigDecimal goalPaceSecPerKm,
        BigDecimal courseDistanceM,
        List<GradeSegment> gradeProfile,
        Plan plan,
        AppliedCoaching lastAppliedCoaching,
        Instant lastResumedAt,
        List<Sample> samples) {

    public record GradeSegment(double startDistanceM, double endDistanceM, double gradePercent) {}

    public record Plan(BigDecimal recommendedPace, List<PlanSegment> segments) {}

    public record PlanSegment(BigDecimal startDistanceM, BigDecimal endDistanceM, BigDecimal pace) {}

    public record AppliedCoaching(
            long coachingId, Instant appliedAt, BigDecimal recommendedPace, CoachingLevel coachingLevel) {}

    /** running_metric_samples 한 행. 심박은 실제 측정(is_hr_measured)일 때만 값이 있다. */
    public record Sample(
            int elapsedSec,
            Instant measuredAt,
            Double heartRateBpm,
            Double speedMps,
            Double gradePercent,
            Double totalDistanceM,
            Double routeProgressM) {}
}
