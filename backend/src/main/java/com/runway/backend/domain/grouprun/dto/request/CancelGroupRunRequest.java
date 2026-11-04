package com.runway.backend.domain.grouprun.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * G13 요청. {@code cancelMessage}는 길이만 검증하며 저장하지 않는다(알림 후속 범위).
 */
public record CancelGroupRunRequest(
        @NotBlank String cancelReason, @Size(max = 100) String cancelMessage) {}
