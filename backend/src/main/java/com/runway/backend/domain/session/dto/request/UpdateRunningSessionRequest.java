package com.runway.backend.domain.session.dto.request;

import com.runway.backend.domain.session.entity.SessionGoal;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import tools.jackson.databind.JsonNode;

/**
 * S08 요청. operation마다 필요한 필드만 받고 다른 작업의 필드가 오면 400으로 거절한다. UPDATE_GOAL의 목표 필드는 생략(유지)과
 * null(해제)을 구분해야 하므로 원본 JSON에서 키 존재 여부를 읽는다.
 */
@Schema(
        description =
                "operation(UPDATE_GOAL/REPORT_PREPARED/TAKE_OVER_PHONE/ABORT_UNCONFIRMED_START),"
                        + " expectedVersion(1 이상) 및 작업별 필드")
public record UpdateRunningSessionRequest(
        Operation operation,
        long expectedVersion,
        Long deviceId,
        Boolean ready,
        String reasonCode,
        Boolean receivedWatchBatchesUploaded,
        GoalPatch goalPatch) {

    private static final String[] GOAL_FIELDS = {
        "courseId", "comparisonSessionId", "targetDistanceM", "targetDurationSec", "targetPaceSecPerKm"
    };

    /** session_control_events.reason_code VARCHAR(64)와 같은 길이. */
    private static final int REASON_CODE_MAX = 64;

    public enum Operation {
        UPDATE_GOAL,
        REPORT_PREPARED,
        TAKE_OVER_PHONE,
        ABORT_UNCONFIRMED_START
    }

    /** 원문 JSON에서 읽는다. 소수는 BigDecimal 그대로 유지한다. */
    public static UpdateRunningSessionRequest fromJson(String raw) {
        return from(JsonFields.readBody(raw));
    }

    public static UpdateRunningSessionRequest from(JsonNode body) {
        JsonFields.requireObject(body);
        Operation operation = parseOperation(JsonFields.requireString(body, "operation"));
        long expectedVersion = JsonFields.requirePositiveLong(body, "expectedVersion");
        String name = operation.name();
        return switch (operation) {
            case UPDATE_GOAL -> {
                JsonFields.forbid(
                        body, name, "deviceId", "ready", "reasonCode", "receivedWatchBatchesUploaded");
                yield new UpdateRunningSessionRequest(
                        operation, expectedVersion, null, null, null, null, GoalPatch.from(body));
            }
            case REPORT_PREPARED -> {
                JsonFields.forbid(body, name, "receivedWatchBatchesUploaded");
                JsonFields.forbid(body, name, GOAL_FIELDS);
                yield new UpdateRunningSessionRequest(
                        operation,
                        expectedVersion,
                        JsonFields.requirePositiveLong(body, "deviceId"),
                        JsonFields.requireBoolean(body, "ready"),
                        JsonFields.requireNullableString(body, "reasonCode", REASON_CODE_MAX),
                        null,
                        null);
            }
            case TAKE_OVER_PHONE -> {
                JsonFields.forbid(body, name, "ready", "reasonCode");
                JsonFields.forbid(body, name, GOAL_FIELDS);
                yield new UpdateRunningSessionRequest(
                        operation,
                        expectedVersion,
                        JsonFields.requirePositiveLong(body, "deviceId"),
                        null,
                        null,
                        JsonFields.requireBoolean(body, "receivedWatchBatchesUploaded"),
                        null);
            }
            case ABORT_UNCONFIRMED_START -> {
                JsonFields.forbid(body, name, "ready", "reasonCode", "receivedWatchBatchesUploaded");
                JsonFields.forbid(body, name, GOAL_FIELDS);
                yield new UpdateRunningSessionRequest(
                        operation,
                        expectedVersion,
                        JsonFields.requirePositiveLong(body, "deviceId"),
                        null,
                        null,
                        null,
                        null);
            }
        };
    }

    private static Operation parseOperation(String value) {
        try {
            return Operation.valueOf(value);
        } catch (IllegalArgumentException ex) {
            throw JsonFields.invalid("operation", "허용되지 않는 작업입니다.");
        }
    }

    /** 키가 없으면 기존 값을 유지하고, null이면 해제한다. */
    public record GoalPatch(
            boolean courseIdPresent,
            Long courseId,
            boolean comparisonSessionIdPresent,
            Long comparisonSessionId,
            boolean distancePresent,
            Integer targetDistanceM,
            boolean durationPresent,
            Integer targetDurationSec,
            boolean pacePresent,
            BigDecimal targetPaceSecPerKm) {

        static GoalPatch from(JsonNode body) {
            return new GoalPatch(
                    body.has("courseId"),
                    JsonFields.optionalPositiveLong(body, "courseId"),
                    body.has("comparisonSessionId"),
                    JsonFields.optionalPositiveLong(body, "comparisonSessionId"),
                    body.has("targetDistanceM"),
                    JsonFields.optionalInt(body, "targetDistanceM"),
                    body.has("targetDurationSec"),
                    JsonFields.optionalInt(body, "targetDurationSec"),
                    body.has("targetPaceSecPerKm"),
                    JsonFields.optionalPace(body, "targetPaceSecPerKm"));
        }

        public SessionGoal applyTo(SessionGoal current) {
            return new SessionGoal(
                    courseIdPresent ? courseId : current.courseId(),
                    comparisonSessionIdPresent ? comparisonSessionId : current.comparisonSessionId(),
                    distancePresent ? targetDistanceM : current.distanceM(),
                    durationPresent ? targetDurationSec : current.durationSec(),
                    pacePresent ? targetPaceSecPerKm : current.paceSecPerKm());
        }
    }
}
