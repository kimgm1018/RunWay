package com.runway.backend.global.exception;

import java.util.Map;
import org.springframework.http.HttpStatusCode;

public class ApiException extends RuntimeException {

    private final HttpStatusCode status;
    private final String code;
    private final Map<String, Object> details;

    public ApiException(HttpStatusCode status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public ApiException(
            HttpStatusCode status, String code, String message, Map<String, Object> details) {
        super(message == null ? ApiErrorResponse.FALLBACK_MESSAGE : message);
        this.status = status;
        this.code = code;
        this.details = ApiErrorResponse.copyDetails(details);
    }

    public HttpStatusCode status() {
        return status;
    }

    public String code() {
        return code;
    }

    public Map<String, Object> details() {
        return details;
    }
}
