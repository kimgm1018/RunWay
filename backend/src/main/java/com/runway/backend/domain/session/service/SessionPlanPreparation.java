package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.SessionPlanSourceRepository;
import com.runway.backend.domain.session.repository.SessionPlanSourceRepository.Course;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/** Prepares immutable results without holding a database transaction or lock. */
@Service
@RequiredArgsConstructor
public class SessionPlanPreparation {
    private final SessionPlanSourceRepository source;
    private final PersonalPacePlanPort port;
    private final SegmentDifficultyProvider difficulty;
    private final SessionAccess access;

    public record Prepared(
            SessionGoal goal,
            String courseStamp,
            boolean personalResult,
            String userStamp,
            Optional<InitialPacePlanCalculator.PlanDraft> draft) {}

    private Course course(Long id) {
        if (id == null) return new Course(null, null, null);
        Course result =
                source.course(id).orElseThrow(() -> new ApiException(ErrorCode.COURSE_NOT_FOUND));
        if (!"ACTIVE".equals(result.status()))
            throw new ApiException(ErrorCode.COURSE_INACCESSIBLE);
        return result;
    }

    public Prepared prepare(long userId, SessionGoal goal) {
        if (TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("AI planning requires no active transaction");
        access.requireActiveUser(userId);
        RunningSessionService.validateTargets(goal);
        Course course = course(goal.courseId());
        var snapshot =
                source.consent(userId).orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        boolean consent = snapshot.granted();
        String userStamp = snapshot.stamp();
        BigDecimal target = InitialPacePlanCalculator.recommendedPace(goal, course.distance());
        if (goal.courseId() == null && target != null) {
            if (target.setScale(2, RoundingMode.HALF_UP).signum() <= 0
                    || target.compareTo(InitialPacePlanCalculator.MAX_PACE) > 0)
                throw new ApiException(ErrorCode.INVALID_GOAL);
            return new Prepared(
                    goal,
                    null,
                    false,
                    userStamp,
                    Optional.of(
                            new InitialPacePlanCalculator.PlanDraft(
                                    target.setScale(2, RoundingMode.HALF_UP), List.of())));
        }
        if (goal.courseId() == null && goal.distanceM() == null)
            return new Prepared(goal, null, false, userStamp, Optional.empty());
        // Non-consenting users use AI05 without userId or health personalization.
        if (target != null
                && (target.setScale(2, RoundingMode.HALF_UP).signum() <= 0
                        || target.compareTo(InitialPacePlanCalculator.MAX_PACE) > 0))
            throw new ApiException(ErrorCode.INVALID_GOAL);
        Optional<PersonalPacePlanPort.Result> result;
        if (consent) result = port.plan(userId, goal);
        else {
            BigDecimal average = source.averagePace(userId);
            String profile = goal.courseId() == null ? null : source.courseProfile(goal.courseId());
            result = port.populationPlan(goal, average, profile);
        }
        BigDecimal distance =
                goal.distanceM() == null ? course.distance() : BigDecimal.valueOf(goal.distanceM());
        result = result.filter(r -> valid(r, consent ? userId : null, goal, distance));
        Optional<InitialPacePlanCalculator.PlanDraft> draft;
        if (target != null) {
            var ratios =
                    result.map(
                            r ->
                                    r.segments().stream()
                                            .map(PersonalPacePlanPort.Segment::ratio)
                                            .toList());
            draft =
                    InitialPacePlanCalculator.calculate(
                            goal,
                            course.distance(),
                            (c, d, n) -> ratios.isPresent() ? ratios : difficulty.ratios(c, d, n));
        } else {
            draft = result.map(SessionPlanPreparation::draftFromAi);
            if (draft.isEmpty()) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        return new Prepared(goal, course.stamp(), consent && result.isPresent(), userStamp, draft);
    }

    private static InitialPacePlanCalculator.PlanDraft draftFromAi(
            PersonalPacePlanPort.Result result) {
        var segments =
                result.segments().stream()
                        .map(
                                s ->
                                        new InitialPacePlanCalculator.SegmentDraft(
                                                s.start(), s.end(), s.pace()))
                        .toList();
        return new InitialPacePlanCalculator.PlanDraft(
                result.pace().setScale(2, RoundingMode.HALF_UP), segments);
    }

    public void verify(long userId, SessionGoal goal, Prepared prepared) {
        var snapshot =
                source.consent(userId).orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        if (prepared == null
                || !goal.sameAs(prepared.goal())
                || (prepared.personalResult()
                        && (!snapshot.granted()
                                || !Objects.equals(prepared.userStamp(), snapshot.stamp())))
                || !Objects.equals(prepared.courseStamp(), course(goal.courseId()).stamp()))
            throw new ApiException(ErrorCode.STALE_STATE);
    }

    private static boolean positive(BigDecimal v) {
        return v != null
                && v.setScale(2, RoundingMode.HALF_UP).signum() > 0
                && v.compareTo(InitialPacePlanCalculator.MAX_PACE) <= 0;
    }

    private static boolean valid(
            PersonalPacePlanPort.Result r, Long userId, SessionGoal goal, BigDecimal distance) {
        if (!Objects.equals(r.courseId(), goal.courseId())
                || !Objects.equals(r.userId(), userId)
                || distance == null
                || r.distance().compareTo(distance) != 0
                || !positive(r.pace())
                || r.segments().isEmpty()) return false;
        BigDecimal end = BigDecimal.ZERO, weighted = BigDecimal.ZERO, totalTime = BigDecimal.ZERO;
        int sequence = 1;
        for (var s : r.segments()) {
            if (s.sequence() != sequence++
                    || s.start().compareTo(end) != 0
                    || s.end().compareTo(s.start()) <= 0
                    || !positive(s.pace())
                    || s.ratio() == null
                    || (userId != null
                            && (s.ratio().compareTo(new BigDecimal("0.85")) < 0
                                    || s.ratio().compareTo(new BigDecimal("1.20")) > 0)))
                return false;
            BigDecimal expected = distance.min(s.start().add(BigDecimal.valueOf(1000)));
            if (s.end().compareTo(expected) != 0) return false;
            BigDecimal derived = r.pace().multiply(s.ratio());
            if (derived.subtract(s.pace()).abs().compareTo(new BigDecimal("0.02")) > 0)
                return false;
            totalTime = totalTime.add(s.end().subtract(s.start()).multiply(s.pace()));
            weighted = weighted.add(s.end().subtract(s.start()).multiply(s.ratio()));
            end = s.end();
        }
        return totalTime
                                .divide(distance, MathContext.DECIMAL64)
                                .subtract(r.pace())
                                .abs()
                                .compareTo(new BigDecimal("0.02"))
                        <= 0
                && end.compareTo(distance) == 0
                && weighted.divide(distance, MathContext.DECIMAL64)
                                .subtract(BigDecimal.ONE)
                                .abs()
                                .compareTo(new BigDecimal("0.000001"))
                        <= 0;
    }
}
