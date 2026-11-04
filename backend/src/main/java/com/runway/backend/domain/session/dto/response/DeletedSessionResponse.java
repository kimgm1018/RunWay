package com.runway.backend.domain.session.dto.response;

import java.time.Instant;

/** S09. 함께 삭제 표시한 게시물에도 같은 deletedAt을 저장한다. */
public record DeletedSessionResponse(long id, Instant deletedAt) {}
