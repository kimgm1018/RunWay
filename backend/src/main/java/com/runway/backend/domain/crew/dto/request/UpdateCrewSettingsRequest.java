package com.runway.backend.domain.crew.dto.request;

/**
 * M12 크루 설정 변경 요청. 보낸 필드만 바꾼다. 범위·허용값은 서비스가 검증해 {@code 422 INVALID_CREW}로 응답한다
 * (S15P31E105-570).
 */
public record UpdateCrewSettingsRequest(Integer capacity, String joinPolicy) {}
