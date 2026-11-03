package com.runway.backend.domain.device.dto.request;

import com.runway.backend.domain.device.service.ConsentErrors;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * W04 요청. U15 동의 항목과 같은 {@code {consentType, granted}} 형식이다. 원문을 직접 읽어 문자열·숫자를 boolean으로 바꾸지 않고, 중복
 * 키는 어느 값이 적용될지 모호하므로 거절한다(W06·W07과 같은 기준). 추가 필드는 무시한다.
 */
public record ConsentChangeRequest(
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        allowableValues = {"HEALTH_DATA"})
                String consentType,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean granted) {

    private static final JsonMapper STRICT =
            JsonMapper.builder()
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();

    /**
     * 형식만 검증한다. 구문 오류·객체 아님·중복 키·필드 누락·자료형 오류는 400 VALIDATION_ERROR다. 유형 값의 허용 여부는 서비스가 판정한다.
     */
    public static ConsentChangeRequest parse(String raw) {
        JsonNode body;
        try {
            body = raw == null ? null : STRICT.readTree(raw);
        } catch (JacksonException e) {
            throw ConsentErrors.validation();
        }
        if (body == null || !body.isObject()) {
            throw ConsentErrors.validation();
        }
        JsonNode type = body.get("consentType");
        JsonNode granted = body.get("granted");
        if (type == null || !type.isString() || granted == null || !granted.isBoolean()) {
            throw ConsentErrors.validation();
        }
        return new ConsentChangeRequest(type.stringValue(), granted.booleanValue());
    }

    @Override
    public String toString() {
        return "ConsentChangeRequest[REDACTED]";
    }
}
