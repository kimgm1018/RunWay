package com.runway.backend.domain.community.dto.request;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** CMT01 생성 요청. imageId는 수신만 하고 저장하지 않는다. */
public record CreatePostRequest(
        @NotNull Long sessionId,
        String body,
        @Size(max = 1024) String imageKey,
        @Size(max = 40) String regionCode,
        @Size(max = 36) String imageId) {}
