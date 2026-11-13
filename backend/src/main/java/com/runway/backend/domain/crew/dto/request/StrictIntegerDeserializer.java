package com.runway.backend.domain.crew.dto.request;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/**
 * 크루 정원처럼 JSON 정수만 받는 필드용(S15P31E105-774). 기본 Jackson 설정은 {@code 1.5}를 1로 자르고
 * {@code "20"}을 20으로 바꿔 범위 검사를 통과시키므로, 정수 토큰이 아니면 자료형 오류로 거절한다. 전역 동작은 그대로다.
 * JSON {@code null}은 이 역직렬화기를 거치지 않고 null로 남아 각 요청의 필수·생략 규칙을 따른다.
 */
public final class StrictIntegerDeserializer extends ValueDeserializer<Integer> {
    @Override
    public Integer deserialize(JsonParser parser, DeserializationContext context) {
        if (parser.currentToken() == JsonToken.VALUE_NUMBER_INT) {
            // int 범위를 넘으면 Jackson이 입력 오류를 던진다.
            return parser.getIntValue();
        }
        return (Integer) context.handleUnexpectedToken(Integer.class, parser);
    }
}
