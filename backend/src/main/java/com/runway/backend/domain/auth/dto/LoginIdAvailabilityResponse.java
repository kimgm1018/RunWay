package com.runway.backend.domain.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record LoginIdAvailabilityResponse(
        String loginId,
        boolean available,
        @Schema(
                        types = {"string", "null"},
                        allowableValues = {"DUPLICATED"})
                String reason) {}
