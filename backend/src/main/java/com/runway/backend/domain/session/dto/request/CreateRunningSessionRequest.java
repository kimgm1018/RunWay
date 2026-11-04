package com.runway.backend.domain.session.dto.request;

import com.runway.backend.domain.session.entity.SessionGoal;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import tools.jackson.databind.JsonNode;

/**
 * S01 요청. 목표 필드의 생략과 null은 같은 의미(미설정)다. 타입 검증은 {@link JsonFields}로 한다.
 *
 * @param targetDistanceM 0·음수는 형식 오류가 아니라 422 INVALID_GOAL로 판정한다
 */
@Schema(
        description =
                "controlDeviceId·relayDeviceId(필수 양의 정수), courseId·comparisonSessionId(양의 정수/null),"
                        + " targetDistanceM·targetDurationSec(정수/null), targetPaceSecPerKm(소수 둘째 자리/null)")
public record CreateRunningSessionRequest(
        long controlDeviceId,
        long relayDeviceId,
        Long courseId,
        Long comparisonSessionId,
        Integer targetDistanceM,
        Integer targetDurationSec,
        BigDecimal targetPaceSecPerKm) {

    /** 원문 JSON에서 읽는다. 소수는 BigDecimal 그대로 유지한다. */
    public static CreateRunningSessionRequest fromJson(String raw) {
        return from(JsonFields.readBody(raw));
    }

    public static CreateRunningSessionRequest from(JsonNode body) {
        JsonFields.requireObject(body);
        return new CreateRunningSessionRequest(
                JsonFields.requirePositiveLong(body, "controlDeviceId"),
                JsonFields.requirePositiveLong(body, "relayDeviceId"),
                JsonFields.optionalPositiveLong(body, "courseId"),
                JsonFields.optionalPositiveLong(body, "comparisonSessionId"),
                JsonFields.optionalInt(body, "targetDistanceM"),
                JsonFields.optionalInt(body, "targetDurationSec"),
                JsonFields.optionalPace(body, "targetPaceSecPerKm"));
    }

    public SessionGoal goal() {
        return new SessionGoal(
                courseId,
                comparisonSessionId,
                targetDistanceM,
                targetDurationSec,
                targetPaceSecPerKm);
    }
}
