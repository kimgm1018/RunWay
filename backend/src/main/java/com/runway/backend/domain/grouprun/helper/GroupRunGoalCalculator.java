package com.runway.backend.domain.grouprun.helper;

import com.runway.backend.domain.grouprun.entity.GoalInputType;
import com.runway.backend.global.exception.ApiException;
import org.springframework.http.HttpStatus;

/**
 * 그룹런 목표 환산. TIME은 거리·시간으로 페이스를, PACE는 거리·페이스로 시간을 계산한다. DB에는 거리·시간만
 * 저장하고 페이스는 응답 파생값이다.
 */
public final class GroupRunGoalCalculator {

    private GroupRunGoalCalculator() {}

    public record ResolvedGoals(Integer distanceM, Integer durationSec, Integer paceSecPerKm) {}

    /**
     * @param courseDistanceMFallback {@code targetDistanceM}이 없을 때 사용할 코스 거리(m). 자유러닝은
     *     null.
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
            throw invalidGoal("목표 필드가 있으면 goalInputType이 필요합니다.");
        }

        GoalInputType goalInputType;
        try {
            goalInputType = GoalInputType.valueOf(goalInputTypeRaw.trim());
        } catch (IllegalArgumentException ex) {
            throw invalidGoal("goalInputType은 TIME 또는 PACE여야 합니다.");
        }

        Integer distanceM =
                targetDistanceM != null ? targetDistanceM : courseDistanceMFallback;
        if (distanceM == null || distanceM <= 0) {
            throw invalidGoal("목표 거리는 양수여야 합니다.");
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
            throw invalidGoal("TIME 목표는 양수 targetDurationSec이 필요합니다.");
        }
        if (targetPaceSecPerKm != null) {
            throw invalidGoal("TIME 목표에는 targetPaceSecPerKm을 함께 보낼 수 없습니다.");
        }
        int pace = (int) Math.round(targetDurationSec * 1000.0 / distanceM);
        if (pace <= 0) {
            throw invalidGoal("계산된 목표 페이스가 유효하지 않습니다.");
        }
        return new ResolvedGoals(distanceM, targetDurationSec, pace);
    }

    private static ResolvedGoals resolvePace(
            int distanceM, Integer targetDurationSec, Integer targetPaceSecPerKm) {
        if (targetPaceSecPerKm == null || targetPaceSecPerKm <= 0) {
            throw invalidGoal("PACE 목표는 양수 targetPaceSecPerKm이 필요합니다.");
        }
        if (targetDurationSec != null) {
            throw invalidGoal("PACE 목표에는 targetDurationSec을 함께 보낼 수 없습니다.");
        }
        int duration = (int) Math.round(targetPaceSecPerKm * distanceM / 1000.0);
        if (duration <= 0) {
            throw invalidGoal("계산된 목표 시간이 유효하지 않습니다.");
        }
        return new ResolvedGoals(distanceM, duration, targetPaceSecPerKm);
    }

    private static ApiException invalidGoal(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", message);
    }
}
