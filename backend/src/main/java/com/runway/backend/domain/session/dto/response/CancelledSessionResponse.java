package com.runway.backend.domain.session.dto.response;

/** S07 응답. 최신 stateVersion이 필요하면 S02로 조회한다. */
public record CancelledSessionResponse(long id, String status) {}
