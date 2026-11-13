package com.runway.backend.domain.grouprun.helper;

import com.runway.backend.domain.grouprun.entity.GoalInputType;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

/** 그룹런 목표 환산. TIME은 거리·시간으로 페이스를, PACE는 거리·페이스로 시간을 계산한다. DB에는 거리·시간만 저장하고 페이스는 응답 파생값이다. */
public final class GroupRunGoalCalculator {
    /** TIME 목표 시간 범위. 앱 그룹런 만들기의 목표 시간 눈금(5~180분)과 같다(S15P31E105-779). */
    public static final int MIN_DURATION_SEC = 5 * 60;

    public static final int MAX_DURATION_SEC = 180 * 60;


    private GroupRunGoalCalculator() {}

    public record ResolvedGoals(Integer distanceM, Integer durationSec, Integer paceSecPerKm) {}

    /**
     * @param courseDistanceMFallback {@code targetDistanceM}이 없을 때 사용할 코스 거리(m). 자유러닝은 null.
     */
    public static ResolvedGoals resolve(
            String goalInputTypeRaw,
            Integer targetDistanceM,
            Integer targetDurationSec,
            Integer targetPaceSecPerKm,
            Integer courseDistanceMFallback) {
        boolean anyGoalField =
                goalInputTypeRaw != null
                        || targetDistanceM != null
                        || targetDurationSec != null
                        || targetPaceSecPerKm != null;
        if (!anyGoalField) {
            return new ResolvedGoals(null, null, null);
        }
        if (goalInputTypeRaw == null || goalInputTypeRaw.isBlank()) {
            throw new ApiException(ErrorCode.GOAL_INPUT_TYPE_REQUIRED);
        }

        GoalInputType goalInputType;
        try {
            goalInputType = GoalInputType.valueOf(goalInputTypeRaw.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.GOAL_INPUT_TYPE_INVALID);
        }

        Integer distanceM = targetDistanceM != null ? targetDistanceM : courseDistanceMFallback;
        if (distanceM == null || distanceM <= 0) {
            throw new ApiException(ErrorCode.GOAL_DISTANCE_INVALID);
        }

        return switch (goalInputType) {
            case TIME -> resolveTime(distanceM, targetDurationSec, targetPaceSecPerKm);
            case PACE -> resolvePace(distanceM, targetDurationSec, targetPaceSecPerKm);
        };
    }

    public static Integer derivePaceSecPerKm(Integer distanceM, Integer durationSec) {
        if (distanceM == null || durationSec == null || distanceM <= 0 || durationSec <= 0) {
            return null;
        }
        return (int) Math.round(durationSec * 1000.0 / distanceM);
    }

    private static ResolvedGoals resolveTime(
            int distanceM, Integer targetDurationSec, Integer targetPaceSecPerKm) {
        if (targetDurationSec == null || targetDurationSec <= 0) {
            throw new ApiException(ErrorCode.GOAL_DURATION_REQUIRED);
        }
        if (targetDurationSec < MIN_DURATION_SEC || targetDurationSec > MAX_DURATION_SEC) {
            throw new ApiException(ErrorCode.GOAL_DURATION_OUT_OF_RANGE);
        }
        if (targetPaceSecPerKm != null) {
            throw new ApiException(ErrorCode.GOAL_TIME_PACE_CONFLICT);
        }
        int pace = (int) Math.round(targetDurationSec * 1000.0 / distanceM);
        if (pace <= 0) {
            throw new ApiException(ErrorCode.GOAL_CALCULATED_PACE_INVALID);
        }
        return new ResolvedGoals(distanceM, targetDurationSec, pace);
    }

    private static ResolvedGoals resolvePace(
            int distanceM, Integer targetDurationSec, Integer targetPaceSecPerKm) {
        if (targetPaceSecPerKm == null || targetPaceSecPerKm <= 0) {
            throw new ApiException(ErrorCode.GOAL_PACE_REQUIRED);
        }
        if (targetDurationSec != null) {
            throw new ApiException(ErrorCode.GOAL_PACE_DURATION_CONFLICT);
        }
        int duration = (int) Math.round(targetPaceSecPerKm * distanceM / 1000.0);
        if (duration <= 0) {
            throw new ApiException(ErrorCode.GOAL_CALCULATED_DURATION_INVALID);
        }
        return new ResolvedGoals(distanceM, duration, targetPaceSecPerKm);
    }
}
