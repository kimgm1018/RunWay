package com.runway.backend.domain.device.service;

import com.runway.backend.global.exception.ApiException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * W06 요청 전체 오류와 레코드 오류 코드(devices-health.md W06). details에는 필드 경로와 사유만 넣고 건강 값 원문은 넣지 않는다.
 */
public final class HealthRecordSyncErrors {

    /** 레코드 형식·값 위반. 응답 errors[].code. */
    public static final String INVALID_RECORD = "INVALID_RECORD";

    /** 지원하지 않는 provider(요청 전체)·type·method(레코드). */
    public static final String UNSUPPORTED_RECORD_TYPE = "UNSUPPORTED_RECORD_TYPE";

    private HealthRecordSyncErrors() {}

    public static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
    }

    public static ApiException validation(String field, String reason) {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "요청 값이 유효하지 않습니다.",
                fields(field, reason));
    }

    public static ApiException validation() {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다.");
    }

    public static ApiException unsupportedProvider() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT,
                UNSUPPORTED_RECORD_TYPE,
                "지원하지 않는 건강 데이터 출처입니다.",
                fields("provider", "지원하지 않는 값입니다."));
    }

    public static ApiException tooLarge() {
        return new ApiException(
                HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다.");
    }

    public static ApiException consentRequired() {
        return new ApiException(HttpStatus.FORBIDDEN, "CONSENT_REQUIRED", "건강정보 수집 동의가 필요합니다.");
    }

    private static Map<String, Object> fields(String field, String reason) {
        return Map.of("fields", List.of(Map.of("name", field, "reason", reason)));
    }
}
