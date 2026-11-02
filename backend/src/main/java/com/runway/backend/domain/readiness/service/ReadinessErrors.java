package com.runway.backend.domain.readiness.service;

import com.runway.backend.global.exception.ApiException;
import org.springframework.http.HttpStatus;

/** R02 오류(readiness.md R02 오류 응답). */
public final class ReadinessErrors {

    private ReadinessErrors() {}

    public static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
    }

    public static ApiException consentRequired() {
        return new ApiException(HttpStatus.FORBIDDEN, "CONSENT_REQUIRED", "건강정보 수집 동의가 필요합니다.");
    }

    public static ApiException notFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND, "ASSESSMENT_NOT_FOUND", "준비도 결과가 없습니다.");
    }
}
