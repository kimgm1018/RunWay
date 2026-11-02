package com.runway.backend.domain.session.service;

import com.runway.backend.global.exception.ApiException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/** 세션 API 오류. 코드는 sessions.md 각 API의 오류 응답 표를 따른다. */
final class SessionErrors {

    private SessionErrors() {}

    static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
    }

    static ApiException validation(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    static ApiException sessionNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "러닝 세션을 찾을 수 없습니다.");
    }

    static ApiException sessionForbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "SESSION_FORBIDDEN", "본인 러닝 세션이 아닙니다.");
    }

    /** S09는 소유권 위반에 NOT_OWNER를 쓴다. */
    static ApiException notOwner() {
        return new ApiException(HttpStatus.FORBIDDEN, "NOT_OWNER", "본인 러닝 기록이 아닙니다.");
    }

    static ApiException deviceForbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "DEVICE_FORBIDDEN", "본인 등록 기기가 아닙니다.");
    }

    static ApiException courseNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "COURSE_NOT_FOUND", "코스를 찾을 수 없습니다.");
    }

    static ApiException courseInaccessible() {
        return new ApiException(
                HttpStatus.FORBIDDEN, "COURSE_INACCESSIBLE", "사용할 수 없는 코스입니다.");
    }

    static ApiException invalidGoal() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "러닝 목표가 유효하지 않습니다.");
    }

    static ApiException invalidComparisonSession() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "INVALID_COMPARISON_SESSION",
                "비교할 수 없는 러닝 기록입니다.");
    }

    static ApiException activeSessionExists(long sessionId) {
        return new ApiException(
                HttpStatus.CONFLICT,
                "ACTIVE_SESSION_EXISTS",
                "진행 중인 러닝 세션이 있습니다.",
                Map.of("sessionId", sessionId));
    }

    static ApiException staleState() {
        return new ApiException(HttpStatus.CONFLICT, "STALE_STATE", "세션 상태가 변경되었습니다. 다시 조회해 주세요.");
    }

    static ApiException commandPending() {
        return new ApiException(HttpStatus.CONFLICT, "COMMAND_PENDING", "처리 중인 제어 명령이 있습니다.");
    }

    static ApiException invalidSessionState() {
        return new ApiException(
                HttpStatus.CONFLICT, "INVALID_SESSION_STATE", "현재 세션 상태에서 처리할 수 없습니다.");
    }

    static ApiException uploadPending() {
        return new ApiException(
                HttpStatus.CONFLICT, "UPLOAD_PENDING", "수신한 워치 기록의 저장을 확인하지 못했습니다.");
    }

    /** S09는 삭제 불가 상태에 INVALID_STATE를 쓴다. */
    static ApiException invalidDeleteState() {
        return new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "현재 상태에서는 삭제할 수 없습니다.");
    }

    /** 재시도해도 결과가 같은 데이터 정합성 오류는 503이 아니라 500이다(api/README 공통 오류 응답). */
    static ApiException integrityViolation() {
        return new ApiException(
                HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "서버 오류가 발생했습니다.");
    }
}
