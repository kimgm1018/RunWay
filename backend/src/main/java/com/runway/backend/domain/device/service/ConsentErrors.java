package com.runway.backend.domain.device.service;

import com.runway.backend.global.exception.ApiException;
import org.springframework.http.HttpStatus;

/** W04·W05 오류. 코드는 devices-health.md W04·W05 오류 응답 표를 따른다. 동의 값은 details에 넣지 않는다. */
public final class ConsentErrors {

    private ConsentErrors() {}

    /** 토큰은 유효하나 활성 회원이 아니다(탈퇴). */
    public static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
    }

    /** 필드 누락·자료형 오류. */
    public static ApiException validation() {
        return new ApiException(
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다.");
    }

    /** 변경할 수 없는 동의 유형(필수 3종·알 수 없는 값). */
    public static ApiException invalidConsent() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_CONSENT", "변경할 수 없는 동의 유형입니다.");
    }
}
