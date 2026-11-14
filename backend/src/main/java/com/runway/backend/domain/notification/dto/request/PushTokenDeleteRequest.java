package com.runway.backend.domain.notification.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** N04 body. */
public record PushTokenDeleteRequest(
        @NotBlank
                @Size(max = PushTokenRegisterRequest.MAX_TOKEN)
                @Pattern(regexp = PushTokenRegisterRequest.TOKEN_PATTERN)
                String token) {}
