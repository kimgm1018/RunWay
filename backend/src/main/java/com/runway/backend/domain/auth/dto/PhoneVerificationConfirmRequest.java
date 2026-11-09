package com.runway.backend.domain.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** U29. 원시 JSON 값을 받아 숫자를 인증번호 문자열로 바꾸지 않는다. */
public record PhoneVerificationConfirmRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string", pattern = "010[0-9]{8}")
                Object phoneNumber,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        allowableValues = {"SIGN_UP", "PASSWORD_RESET"})
                Object purpose,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string", pattern = "[0-9]{6}")
                Object code) {
    @Override
    public String toString() {
        return "PhoneVerificationConfirmRequest[REDACTED]";
    }
}
