package com.runway.backend.domain.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** Documentation schema; SignupRequest keeps raw JSON for strict runtime validation. */
public record SignupConsent(
        @Schema(
                        type = "string",
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        allowableValues = {
                            "TERMS_OF_SERVICE",
                            "PERSONAL_INFO",
                            "LOCATION_DATA",
                            "HEALTH_DATA"
                        })
                String consentType,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean granted) {
    @Override
    public String toString() {
        return "SignupConsent[REDACTED]";
    }
}
