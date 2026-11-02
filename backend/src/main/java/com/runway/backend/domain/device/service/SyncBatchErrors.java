package com.runway.backend.domain.device.service;

import com.runway.backend.global.exception.ApiException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * W07 오류. 코드는 devices-health.md W07 "오류와 재시도" 표를 따른다. details에는 필드 경로와 사유만 넣고 측정값·좌표·해시
 * 원문은 넣지 않는다.
 */
public final class SyncBatchErrors {

    private SyncBatchErrors() {}

    public static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
    }

    /** JSON 구문·필수 필드·자료형·ID 범위 오류. */
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

    /** 지원하지 않는 버전·타입·추가 필드·단위/범위/자릿수·해시 위반·빈 items. batch 전체를 거절한다. */
    public static ApiException invalidBatch(String field, String reason) {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "INVALID_BATCH",
                "배치 내용이 유효하지 않습니다.",
                fields(field, reason));
    }

    public static ApiException tooLarge() {
        return new ApiException(
                HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다.");
    }

    public static ApiException deviceForbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "DEVICE_FORBIDDEN", "본인 등록 기기가 아닙니다.");
    }

    public static ApiException sessionForbidden() {
        return new ApiException(
                HttpStatus.FORBIDDEN, "SESSION_FORBIDDEN", "본인 러닝 세션과 기기 관계가 맞지 않습니다.");
    }

    public static ApiException consentRequired() {
        return new ApiException(HttpStatus.FORBIDDEN, "CONSENT_REQUIRED", "건강정보 수집 동의가 필요합니다.");
    }

    public static ApiException hashConflict() {
        return new ApiException(
                HttpStatus.CONFLICT, "BATCH_HASH_CONFLICT", "같은 배치 ID로 다른 내용이 이미 저장되었습니다.");
    }

    public static ApiException invalidSessionState() {
        return new ApiException(
                HttpStatus.CONFLICT, "INVALID_SESSION_STATE", "현재 세션 상태에서 처리할 수 없습니다.");
    }

    public static ApiException controlDeviceChanged() {
        return new ApiException(
                HttpStatus.CONFLICT, "CONTROL_DEVICE_CHANGED", "기록 제어 기기가 변경되었습니다.");
    }

    private static Map<String, Object> fields(String field, String reason) {
        return Map.of("fields", List.of(Map.of("name", field, "reason", reason)));
    }
}
