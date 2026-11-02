package com.runway.backend.domain.user.exception;

import com.runway.backend.global.exception.ApiException;
import org.springframework.http.HttpStatus;

public final class UserProfileErrors {
    private UserProfileErrors() {}

    public static ApiException invalidProfile() {
        return new ApiException(
                HttpStatus.BAD_REQUEST, "INVALID_PROFILE", "요청 값이 유효하지 않습니다.");
    }

    public static ApiException validation() {
        return new ApiException(
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다.");
    }

    public static ApiException nicknameDuplicated() {
        return new ApiException(
                HttpStatus.CONFLICT, "NICKNAME_DUPLICATED", "이미 사용 중인 닉네임입니다.");
    }

    public static ApiException invalidImage() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "INVALID_IMAGE",
                "프로필 이미지로 사용할 수 없습니다.");
    }

    public static ApiException unavailable() {
        return new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "일시적으로 처리할 수 없습니다.");
    }
}
