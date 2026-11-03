package com.runway.backend.global.exception;

/** W06 부분 성공 응답의 레코드별 거절 코드. 요청 전체의 HTTP 오류와 구분한다. */
public enum HealthRecordErrorCode {
    INVALID_RECORD,
    UNSUPPORTED_RECORD_TYPE
}
