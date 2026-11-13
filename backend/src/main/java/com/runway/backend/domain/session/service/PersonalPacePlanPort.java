package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.SessionGoal;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/** Remote pre-run planning. Call outside transactions and locks. */
public interface PersonalPacePlanPort {
    Optional<Result> plan(Long userId, SessionGoal goal);

    default Optional<Result> populationPlan(
            SessionGoal goal, BigDecimal averagePace, String gradeProfile) {
        return Optional.empty();
    }

    record Segment(
            int sequence, BigDecimal start, BigDecimal end, BigDecimal pace, BigDecimal ratio) {}

    /**
     * @param paceSearchBoundaryHit AI09가 페이스 탐색 범위 끝에 걸려 최선 노력 값을 냈는지(응답 {@code paceSearchBoundaryHit}). 그룹런
     *     출발 추천 clamp에 쓴다(S15P31E105-785). 없으면 false.
     */
    record Result(
            Long courseId,
            Long userId,
            BigDecimal distance,
            BigDecimal pace,
            List<Segment> segments,
            boolean paceSearchBoundaryHit) {
        public Result {
            segments = List.copyOf(segments);
        }

        public Result(
                Long courseId, Long userId, BigDecimal distance, BigDecimal pace, List<Segment> segments) {
            this(courseId, userId, distance, pace, segments, false);
        }
    }
}
