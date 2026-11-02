package com.runway.backend.domain.session.dto.request;

import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import java.time.Instant;
import tools.jackson.databind.JsonNode;

/**
 * S03~S06 공통 본문. 단계에 해당하는 필드만 받는다. REQUEST는 승인 요청, RESULT는 현재 실행기기의 실제 결과 보고다. RESULT의 appliedAt·
 * reasonCode는 값이 없어도 키를 포함해야 하며, uploadComplete는 S06(END) RESULT에서만 받는다.
 */
public record SessionControlRequest(
        Phase phase,
        long deviceId,
        Long expectedVersion,
        Long commandId,
        ControlResult result,
        Instant appliedAt,
        String reasonCode,
        Boolean uploadComplete) {

    public enum Phase {
        REQUEST,
        RESULT
    }

    private static final int REASON_CODE_MAX = 64;

    public static SessionControlRequest fromJson(String raw, ControlAction action) {
        JsonNode body = JsonFields.requireObject(JsonFields.readBody(raw));
        Phase phase = phase(body);
        long deviceId = JsonFields.requirePositiveLong(body, "deviceId");
        if (phase == Phase.REQUEST) {
            JsonFields.forbid(
                    body, "REQUEST", "commandId", "result", "appliedAt", "reasonCode", "uploadComplete");
            long expectedVersion = JsonFields.requirePositiveLong(body, "expectedVersion");
            return new SessionControlRequest(
                    phase, deviceId, expectedVersion, null, null, null, null, null);
        }

        JsonFields.forbid(body, "RESULT", "expectedVersion");
        long commandId = JsonFields.requirePositiveLong(body, "commandId");
        ControlResult result = result(body);
        Instant appliedAt = JsonFields.requireNullableUtcInstant(body, "appliedAt");
        if ((result == ControlResult.APPLIED) != (appliedAt != null)) {
            throw JsonFields.invalid("appliedAt", "APPLIED일 때만 실제 적용시각을 보내고, 그 외에는 null입니다.");
        }
        String reasonCode = JsonFields.requireNullableString(body, "reasonCode", REASON_CODE_MAX);
        Boolean uploadComplete = null;
        if (JsonFields.has(body, "uploadComplete")) {
            if (action != ControlAction.END) {
                throw JsonFields.invalid("uploadComplete", "종료(END) 결과에서만 보냅니다.");
            }
            uploadComplete = JsonFields.requireBoolean(body, "uploadComplete");
        }
        return new SessionControlRequest(
                phase, deviceId, null, commandId, result, appliedAt, reasonCode, uploadComplete);
    }

    private static Phase phase(JsonNode body) {
        String value = JsonFields.requireString(body, "phase");
        try {
            return Phase.valueOf(value);
        } catch (IllegalArgumentException e) {
            throw JsonFields.invalid("phase", "REQUEST 또는 RESULT여야 합니다.");
        }
    }

    /** PENDING·IGNORED는 보고하지 않는다. IGNORED는 P07 COACHING 전용이다. */
    private static ControlResult result(JsonNode body) {
        String value = JsonFields.requireString(body, "result");
        return switch (value) {
            case "APPLIED" -> ControlResult.APPLIED;
            case "REJECTED" -> ControlResult.REJECTED;
            case "UNKNOWN" -> ControlResult.UNKNOWN;
            default -> throw JsonFields.invalid("result", "APPLIED, REJECTED, UNKNOWN 중 하나여야 합니다.");
        };
    }
}
