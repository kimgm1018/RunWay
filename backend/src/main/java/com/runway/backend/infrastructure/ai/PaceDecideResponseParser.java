package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.coaching.decide.PaceDecision;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Optional;

/**
 * AI04 200 응답을 검증해 {@link PaceDecision}으로 바꾼다(ai-service.md "AI04 Response"). 저장할 필드가 DB 범위(NUMERIC 정밀도,
 * cue_bpm 60~220)를 벗어나거나 형식이 다르면 응답 전체를 계약 위반으로 본다. 사유에는 필드 이름만 담고 값은 담지 않는다.
 */
final class PaceDecideResponseParser {

    /** coaching_decisions.recommended_pace NUMERIC(10,2) 안의 현실적인 상한(초/km). */
    static final double MAX_PACE = 3600;

    /** NUMERIC(7,2) 심박 열의 현실적인 상한(bpm). */
    static final double MAX_HR = 300;

    /** NUMERIC(12,2) 진행거리 상한(m). */
    static final double MAX_PROGRESS = 1_000_000;

    static final class InvalidResponse extends Exception {
        InvalidResponse(String field) {
            super(field, null, false, false);
        }
    }

    private final JsonMapper jsonMapper;

    PaceDecideResponseParser(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    /** @return 판단이 없으면({@code decision=null}) 빈 값 */
    Optional<PaceDecision> parse(byte[] body) throws InvalidResponse {
        JsonNode root;
        try {
            root = jsonMapper.readTree(body);
        } catch (RuntimeException ex) {
            throw new InvalidResponse("body");
        }
        if (root == null || !root.isObject()) {
            throw new InvalidResponse("body");
        }
        JsonNode suggested = root.get("publishSuggested");
        if (suggested == null || !suggested.isBoolean()) {
            throw new InvalidResponse("publishSuggested");
        }
        JsonNode decision = root.get("decision");
        if (decision == null || decision.isNull()) {
            return Optional.empty();
        }
        if (!decision.isObject()) {
            throw new InvalidResponse("decision");
        }
        PaceDecision.Action action;
        try {
            action = PaceDecision.Action.valueOf(requiredString(decision, "action"));
        } catch (IllegalArgumentException ex) {
            throw new InvalidResponse("decision.action");
        }
        BigDecimal pace = requiredDecimal(decision, "recommendedPaceSecPerKm", MAX_PACE);
        if (pace.signum() <= 0) {
            throw new InvalidResponse("decision.recommendedPaceSecPerKm");
        }
        return Optional.of(
                new PaceDecision(
                        suggested.booleanValue(),
                        action,
                        pace,
                        cueBpm(decision.get("cueBpm")),
                        optionalDecimal(decision, "predictedHr30Bpm", MAX_HR),
                        optionalDecimal(decision, "predictedHr60Bpm", MAX_HR),
                        optionalDecimal(decision, "predictedHr120Bpm", MAX_HR),
                        optionalDecimal(decision, "routeProgressM", MAX_PROGRESS),
                        requiredLong(decision, "basedOnStateVersion"),
                        requiredInstant(decision, "expiresAt")));
    }

    private static Integer cueBpm(JsonNode node) throws InvalidResponse {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isIntegralNumber() || !node.canConvertToInt()) {
            throw new InvalidResponse("decision.cueBpm");
        }
        int value = node.intValue();
        if (value < 60 || value > 220) {
            throw new InvalidResponse("decision.cueBpm");
        }
        return value;
    }

    private static String requiredString(JsonNode parent, String field) throws InvalidResponse {
        JsonNode node = parent.get(field);
        if (node == null || !node.isString()) {
            throw new InvalidResponse("decision." + field);
        }
        return node.stringValue();
    }

    private static long requiredLong(JsonNode parent, String field) throws InvalidResponse {
        JsonNode node = parent.get(field);
        if (node == null || !node.isIntegralNumber() || !node.canConvertToLong()) {
            throw new InvalidResponse("decision." + field);
        }
        return node.longValue();
    }

    private static Instant requiredInstant(JsonNode parent, String field) throws InvalidResponse {
        String text = requiredString(parent, field);
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException ex) {
            // 시간대 오프셋 형식(+00:00)도 받는다.
            try {
                return java.time.OffsetDateTime.parse(text).toInstant();
            } catch (DateTimeParseException again) {
                throw new InvalidResponse("decision." + field);
            }
        }
    }

    private static BigDecimal requiredDecimal(JsonNode parent, String field, double max)
            throws InvalidResponse {
        BigDecimal value = optionalDecimal(parent, field, max);
        if (value == null) {
            throw new InvalidResponse("decision." + field);
        }
        return value;
    }

    /** 유한한 0 이상 max 이하 숫자를 소수 둘째 자리로 맞춘다. null·생략은 null. */
    private static BigDecimal optionalDecimal(JsonNode parent, String field, double max)
            throws InvalidResponse {
        JsonNode node = parent.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isNumber()) {
            throw new InvalidResponse("decision." + field);
        }
        double value = node.doubleValue();
        if (!Double.isFinite(value) || value < 0 || value > max) {
            throw new InvalidResponse("decision." + field);
        }
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP);
    }
}
