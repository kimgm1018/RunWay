package com.runway.backend.domain.grouprun.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * G13 요청. {@code cancelMessage}는 길이만 검증한다. 저장하지 않으며 향후 취소 알림 본문 전달 전용이다.
 */
public record CancelGroupRunRequest(
        @NotBlank String cancelReason, @Size(max = 100) String cancelMessage) {}
