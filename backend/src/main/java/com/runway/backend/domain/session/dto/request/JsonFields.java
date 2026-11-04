package com.runway.backend.domain.session.dto.request;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * 원본 JSON 값을 엄격히 읽는다. Jackson 기본 변환은 5000.5를 정수로 자르거나 "101"을 숫자로 받아들이므로, 세션 요청은 타입이 다른 값을 400으로
 * 거절하기 위해 JsonNode에서 직접 읽는다.
 */
final class JsonFields {

    /** goal_pace·pace_plans NUMERIC(10,2) 범위. */
    private static final int PACE_INTEGER_DIGITS = 8;

    private static final int PACE_FRACTION_DIGITS = 2;

    /** 소수를 double로 거치지 않고 원문 그대로 BigDecimal로 읽는다. 300.0000000000000001이 300으로 반올림돼 통과하지 않게 한다. */
    private static final JsonMapper EXACT_NUMBERS =
            JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    /** 기기 시각으로 받는 실제 적용시각의 허용 범위. 범위 밖은 TIMESTAMPTZ 저장에서 500이 되므로 400으로 막는다. */
    private static final Instant MIN_INSTANT = Instant.parse("2000-01-01T00:00:00Z");

    private static final Instant MAX_INSTANT = Instant.parse("9999-12-31T23:59:59.999999Z");

    private JsonFields() {}

    static JsonNode readBody(String raw) {
        try {
            return EXACT_NUMBERS.readTree(raw);
        } catch (JacksonException e) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
    }

    static JsonNode requireObject(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw invalid("body", "JSON 객체여야 합니다.");
        }
        return body;
    }

    static boolean has(JsonNode body, String name) {
        return body.has(name);
    }

    static long requirePositiveLong(JsonNode body, String name) {
        Long value = optionalPositiveLong(body, name);
        if (value == null) {
            throw invalid(name, "필수 값입니다.");
        }
        return value;
    }

    /** 생략·null은 null. 양의 int64 정수만 허용한다. */
    static Long optionalPositiveLong(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isIntegralNumber() || !node.canConvertToLong() || node.longValue() <= 0) {
            throw invalid(name, "양의 정수여야 합니다.");
        }
        return node.longValue();
    }

    /** 생략·null은 null. 0·음수는 형식이 맞으므로 받아서 목표 검증(422)에 넘긴다. */
    static Integer optionalInt(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isIntegralNumber() || !node.canConvertToInt()) {
            throw invalid(name, "정수여야 합니다.");
        }
        return node.intValue();
    }

    /** 생략·null은 null. 소수 둘째 자리까지, 정수부 8자리까지 허용한다. 저장·응답 표기가 같도록 소수 둘째 자리로 맞춘다(3E+2가 아닌 300.00). */
    static BigDecimal optionalPace(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isNumber()) {
            throw invalid(name, "숫자여야 합니다.");
        }
        if (node.isDouble() && !Double.isFinite(node.doubleValue())) {
            throw invalid(name, "소수 둘째 자리까지, 정수부 8자리까지 허용됩니다.");
        }
        BigDecimal value = node.decimalValue().stripTrailingZeros();
        int scale = Math.max(value.scale(), 0);
        if (scale > PACE_FRACTION_DIGITS
                || value.precision() - value.scale() > PACE_INTEGER_DIGITS) {
            throw invalid(name, "소수 둘째 자리까지, 정수부 8자리까지 허용됩니다.");
        }
        return value.setScale(PACE_FRACTION_DIGITS, RoundingMode.UNNECESSARY);
    }

    static boolean requireBoolean(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null || !node.isBoolean()) {
            throw invalid(name, "true 또는 false여야 합니다.");
        }
        return node.booleanValue();
    }

    static String requireString(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null || !node.isString()) {
            throw invalid(name, "문자열이어야 합니다.");
        }
        return node.stringValue();
    }

    /** 키는 반드시 있어야 하고 값은 문자열 또는 null이다. */
    static String requireNullableString(JsonNode body, String name, int maxLength) {
        JsonNode node = body.get(name);
        if (node == null) {
            throw invalid(name, "필수 값입니다. 사유가 없으면 null로 보냅니다.");
        }
        if (node.isNull()) {
            return null;
        }
        if (!node.isString()
                || node.stringValue().isEmpty()
                || node.stringValue().length() > maxLength) {
            throw invalid(name, "1~" + maxLength + "자 문자열 또는 null이어야 합니다.");
        }
        return node.stringValue();
    }

    /**
     * 키는 반드시 있어야 하고 값은 `Z`로 끝나는 UTC ISO-8601 문자열 또는 null이다. DB(TIMESTAMPTZ) 정밀도와 같도록 마이크로초로 자른다. 같은
     * 시각을 다른 소수 자릿수로 재전송해도 같은 값으로 비교된다.
     */
    static Instant requireNullableUtcInstant(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null) {
            throw invalid(name, "필수 값입니다. 값이 없으면 null로 보냅니다.");
        }
        if (node.isNull()) {
            return null;
        }
        if (!node.isString() || !node.stringValue().endsWith("Z")) {
            throw invalid(name, "UTC(Z) ISO-8601 시각이어야 합니다.");
        }
        Instant value;
        try {
            value = Instant.parse(node.stringValue()).truncatedTo(ChronoUnit.MICROS);
        } catch (DateTimeParseException e) {
            throw invalid(name, "UTC(Z) ISO-8601 시각이어야 합니다.");
        }
        if (value.isBefore(MIN_INSTANT) || value.isAfter(MAX_INSTANT)) {
            throw invalid(name, "2000-01-01T00:00:00Z ~ 9999-12-31T23:59:59Z 범위여야 합니다.");
        }
        return value;
    }

    static void forbid(JsonNode body, String operation, String... names) {
        for (String name : names) {
            if (body.has(name)) {
                throw invalid(name, operation + "에서는 보내지 않습니다.");
            }
        }
    }

    static ApiException invalid(String name, String reason) {
        return new ApiException(
                ErrorCode.VALIDATION_ERROR,
                Map.of("fields", List.of(Map.of("name", name, "reason", reason))));
    }
}
