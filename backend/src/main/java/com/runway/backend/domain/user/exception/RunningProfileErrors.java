package com.runway.backend.domain.user.exception;

import com.runway.backend.global.exception.ApiException;

import org.springframework.http.HttpStatus;

public final class RunningProfileErrors {
    private RunningProfileErrors() {}

    public static ApiException malformed() {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "입력 형식을 확인해 주세요.");
    }

    public static ApiException invalidLevel() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_LEVEL", "러닝 수준을 확인해 주세요.");
    }

    public static ApiException invalidBaseline() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_RUNNING_BASELINE", "평소 러닝 정보를 확인해 주세요.");
    }

    public static ApiException notSet() {
        return new ApiException(HttpStatus.NOT_FOUND, "PROFILE_NOT_SET", "러닝 초기 설정이 필요합니다.");
    }

    public static ApiException unavailable() {
        return new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "일시적으로 처리할 수 없습니다.");
    }
}
