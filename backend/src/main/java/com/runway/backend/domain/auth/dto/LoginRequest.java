package com.runway.backend.domain.auth.dto;

import com.runway.backend.domain.auth.validation.LoginField;
import io.swagger.v3.oas.annotations.media.Schema;

/** Object fields deliberately reject JSON number/boolean-to-string coercion during validation. */
public record LoginRequest(
        @Schema(type = "string", minLength = 4, maxLength = 16, pattern = "[A-Za-z0-9]{4,16}")
                @LoginField(LoginField.Kind.LOGIN_ID)
                Object loginId,
        @Schema(type = "string", format = "password", minLength = 8, maxLength = 20)
                @LoginField(LoginField.Kind.PASSWORD)
                Object password) {
    @Override
    public String toString() {
        return "LoginRequest[REDACTED]";
    }
}
