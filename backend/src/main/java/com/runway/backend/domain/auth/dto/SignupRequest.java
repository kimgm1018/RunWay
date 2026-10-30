package com.runway.backend.domain.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** Raw JSON values prevent coercion of numbers and strings into credentials or consent booleans. */
public record SignupRequest(
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        minLength = 4,
                        maxLength = 16)
                Object loginId,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        format = "password",
                        minLength = 8,
                        maxLength = 20)
                Object password,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        minLength = 2,
                        maxLength = 10)
                Object nickname,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string", format = "date")
                Object birthDate,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        allowableValues = {"MALE", "FEMALE"})
                Object gender,
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        type = "string",
                        pattern = "010[0-9]{8}")
                Object phoneNumber,
        @Schema(
                        implementation = SignupConsent[].class,
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        description = "Four distinct consent types, exactly one of each")
                Object consents) {
    @Override
    public String toString() {
        return "SignupRequest[REDACTED]";
    }
}
