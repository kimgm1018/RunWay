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

    record Result(
            Long courseId,
            Long userId,
            BigDecimal distance,
            BigDecimal pace,
            List<Segment> segments) {
        public Result {
            segments = List.copyOf(segments);
        }
    }
}
