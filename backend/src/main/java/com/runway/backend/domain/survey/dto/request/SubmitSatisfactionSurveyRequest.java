package com.runway.backend.domain.survey.dto.request;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * SV01 만족도 응답 제출 요청.
 *
 * <p>score는 JSON 정수만 받는다. Jackson 기본 설정은 4.7·"5"를 정수로 바꿔 받아들이므로(버림) 노드 형식을 직접 확인해, 정수가 아닌 값은
 * 읽기 실패(400 VALIDATION_ERROR, details 없음)로 거절한다. comment도 문자열·null만 받는다.
 *
 * <p>comment는 앞뒤 공백(유니코드 공백·NBSP·폭 없는 공백 포함)을 지우고 빈 문자열이면 null로 바꾼 뒤 검증한다. 글자 수는 H08·닉네임처럼
 * 코드 포인트로 세며(DB VARCHAR(1000)과 같다), 여러 줄 입력이므로 줄바꿈·탭은 허용하고 그 밖의 제어 문자(Cc: C0·DEL·C1, NUL 포함)와 짝이 맞지 않는
 * 서로게이트(Cs)는 거절한다.
 */
public record SubmitSatisfactionSurveyRequest(
        @NotNull @Min(1) @Max(5) Integer score,
        @Pattern(
                        regexp = "[^\\p{Cs}\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F]{0,1000}",
                        message = "1000자 이하로, 쓸 수 없는 문자 없이 입력해 주세요.")
                String comment,
        @NotNull @Pattern(regexp = "RUN_RESULT|SETTINGS") String source) {

    public SubmitSatisfactionSurveyRequest {
        comment = normalize(comment);
    }

    @JsonCreator
    static SubmitSatisfactionSurveyRequest from(
            @JsonProperty("score") JsonNode score,
            @JsonProperty("comment") JsonNode comment,
            @JsonProperty("source") String source) {
        return new SubmitSatisfactionSurveyRequest(score(score), text(comment), source);
    }

    private static Integer score(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (!node.isIntegralNumber() || !node.canConvertToInt()) {
            throw new IllegalArgumentException("score must be an integer");
        }
        return node.intValue();
    }

    private static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (!node.isString()) {
            throw new IllegalArgumentException("comment must be a string or null");
        }
        return node.stringValue();
    }

    private static String normalize(String comment) {
        if (comment == null) {
            return null;
        }
        int start = 0;
        int end = comment.length();
        while (start < end) {
            int cp = comment.codePointAt(start);
            if (!blank(cp)) break;
            start += Character.charCount(cp);
        }
        while (end > start) {
            int cp = comment.codePointBefore(end);
            if (!blank(cp)) break;
            end -= Character.charCount(cp);
        }
        return start == end ? null : comment.substring(start, end);
    }

    private static boolean blank(int cp) {
        return Character.isWhitespace(cp)
                || Character.isSpaceChar(cp)
                || cp == 0x200B
                || cp == 0xFEFF;
    }
}
