package com.runway.backend.domain.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** U28. 원시 JSON 값을 받아 숫자·불리언을 문자열로 바꾸지 않는다. */
public record PhoneVerificationRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string", pattern = "010[0-9]{8}")
                Object phoneNumber,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        allowableValues = {"SIGN_UP", "PASSWORD_RESET"})
                Object purpose) {
    @Override
    public String toString() {
        return "PhoneVerificationRequest[REDACTED]";
    }
}
