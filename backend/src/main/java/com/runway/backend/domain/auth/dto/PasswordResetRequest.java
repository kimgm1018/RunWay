package com.runway.backend.domain.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** U30. 원시 JSON 값을 받아 숫자를 비밀번호·증명 문자열로 바꾸지 않는다. */
public record PasswordResetRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string")
                Object verificationToken,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        format = "password",
                        minLength = 8,
                        maxLength = 20)
                Object newPassword) {
    @Override
    public String toString() {
        return "PasswordResetRequest[REDACTED]";
    }
}
