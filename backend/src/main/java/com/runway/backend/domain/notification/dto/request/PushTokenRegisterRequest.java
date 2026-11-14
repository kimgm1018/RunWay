package com.runway.backend.domain.notification.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** N03 body. FCM registration tokens are URL-safe ASCII; anything else is rejected before storage. */
public record PushTokenRegisterRequest(
        @NotBlank @Size(max = PushTokenRegisterRequest.MAX_TOKEN) @Pattern(regexp = TOKEN_PATTERN)
                String token,
        @NotNull @Pattern(regexp = "ANDROID") String platform) {
    public static final int MAX_TOKEN = 512;
    public static final String TOKEN_PATTERN = "[A-Za-z0-9_:.-]+";
}
