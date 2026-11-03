package com.runway.backend.global.exception;

import org.springframework.http.HttpStatusCode;

import java.util.Map;
import java.util.Objects;

public class ApiException extends RuntimeException {
    private final ErrorCode errorCode;
    private final Map<String, Object> details;

    public ApiException(ErrorCode errorCode, String... arguments) {
        this(errorCode, Map.of(), arguments);
    }

    public ApiException(ErrorCode errorCode, Map<String, Object> details, String... arguments) {
        super(Objects.requireNonNull(errorCode).message(arguments));
        this.errorCode = errorCode;
        this.details = ApiErrorResponse.copyDetails(details);
    }

    public ErrorCode errorCode() {
        return errorCode;
    }

    public HttpStatusCode status() {
        return errorCode.status();
    }

    public String code() {
        return errorCode.code();
    }

    public Map<String, Object> details() {
        return details;
    }
}
