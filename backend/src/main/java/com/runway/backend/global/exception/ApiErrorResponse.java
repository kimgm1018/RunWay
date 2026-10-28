package com.runway.backend.global.exception;

import java.util.LinkedHashMap;
import java.util.Map;

public record ApiErrorResponse(String code, String message, Map<String, Object> details) {

    static final String FALLBACK_MESSAGE = "요청을 처리할 수 없습니다.";

    public ApiErrorResponse {
        if (message == null) {
            message = FALLBACK_MESSAGE;
        }
        details = copyDetails(details);
    }

    static Map<String, Object> copyDetails(Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> copied = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : details.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                copied.put(entry.getKey(), entry.getValue());
            }
        }
        return Map.copyOf(copied);
    }

    public static ApiErrorResponse of(String code, String message, Map<String, Object> details) {
        return new ApiErrorResponse(code, message, details);
    }
}
