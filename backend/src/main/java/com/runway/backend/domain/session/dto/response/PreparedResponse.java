package com.runway.backend.domain.session.dto.response;

/** S08 REPORT_PREPARED. 서버가 확인한 워치 준비 결과의 버전만 돌려준다. */
public record PreparedResponse(long expectedVersion) {}
