package com.runway.backend.domain.session.dto.request;

import com.runway.backend.domain.session.entity.ControlResult;

import tools.jackson.databind.JsonNode;

import java.time.Instant;

/**
 * P07 본문. REQUEST는 앱의 수동 BPM 변경 승인 요청(operation=SET_BPM, coachingId=null)이고, RESULT는 현재 제어 워치의 실제 결과
 * 보고다(SET_BPM·COACHING 공통). COACHING 승인은 서버 내부 전용이므로 앱이 보내면 400이다.
 */
public record SessionBpmRequest(
        Phase phase,
        long deviceId,
        Long expectedVersion,
        Integer targetBpm,
        Long commandId,
        ControlResult result,
        Instant appliedAt,
        String reasonCode) {

    public enum Phase {
        REQUEST,
        RESULT
    }

    public static final int MIN_BPM = 60;
    public static final int MAX_BPM = 220;
    private static final int REASON_CODE_MAX = 64;

    public static SessionBpmRequest fromJson(String raw) {
        JsonNode body = JsonFields.requireObject(JsonFields.readBody(raw));
        Phase phase = phase(body);
        long deviceId = JsonFields.requirePositiveLong(body, "deviceId");
        if (phase == Phase.REQUEST) {
            JsonFields.forbid(body, "REQUEST", "commandId", "result", "appliedAt", "reasonCode");
            String operation = JsonFields.requireString(body, "operation");
            if (!"SET_BPM".equals(operation)) {
                throw JsonFields.invalid("operation", "앱은 SET_BPM만 요청할 수 있습니다.");
            }
            long expectedVersion = JsonFields.requirePositiveLong(body, "expectedVersion");
            Integer targetBpm = JsonFields.optionalInt(body, "targetBpm");
            if (targetBpm == null || targetBpm < MIN_BPM || targetBpm > MAX_BPM) {
                throw JsonFields.invalid("targetBpm", "60~220 정수여야 합니다.");
            }
            if (!JsonFields.has(body, "coachingId") || !body.get("coachingId").isNull()) {
                throw JsonFields.invalid("coachingId", "SET_BPM 요청은 null로 보냅니다.");
            }
            return new SessionBpmRequest(
                    phase, deviceId, expectedVersion, targetBpm, null, null, null, null);
        }

        JsonFields.forbid(body, "RESULT", "operation", "expectedVersion", "targetBpm", "coachingId");
        long commandId = JsonFields.requirePositiveLong(body, "commandId");
        ControlResult result = result(body);
        Instant appliedAt = JsonFields.requireNullableUtcInstant(body, "appliedAt");
        if ((result == ControlResult.APPLIED) != (appliedAt != null)) {
            throw JsonFields.invalid("appliedAt", "APPLIED일 때만 실제 적용시각을 보내고, 그 외에는 null입니다.");
        }
        String reasonCode = JsonFields.requireNullableString(body, "reasonCode", REASON_CODE_MAX);
        return new SessionBpmRequest(
                phase, deviceId, null, null, commandId, result, appliedAt, reasonCode);
    }

    private static Phase phase(JsonNode body) {
        String value = JsonFields.requireString(body, "phase");
        try {
            return Phase.valueOf(value);
        } catch (IllegalArgumentException e) {
            throw JsonFields.invalid("phase", "REQUEST 또는 RESULT여야 합니다.");
        }
    }

    /** PENDING은 보고할 수 없다. IGNORED는 COACHING 명령에만 허용하며 서비스에서 명령 종류로 검사한다. */
    private static ControlResult result(JsonNode body) {
        String value = JsonFields.requireString(body, "result");
        return switch (value) {
            case "APPLIED" -> ControlResult.APPLIED;
            case "REJECTED" -> ControlResult.REJECTED;
            case "IGNORED" -> ControlResult.IGNORED;
            case "UNKNOWN" -> ControlResult.UNKNOWN;
            default ->
                    throw JsonFields.invalid(
                            "result", "APPLIED, REJECTED, IGNORED, UNKNOWN 중 하나여야 합니다.");
        };
    }
}
