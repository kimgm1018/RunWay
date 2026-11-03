package com.runway.backend.domain.auth.dto;

import com.runway.backend.domain.auth.validation.RefreshTokenField;

import io.swagger.v3.oas.annotations.media.Schema;

public record RefreshTokenRequest(@Schema(type = "string") @RefreshTokenField Object refreshToken) {
    @Override
    public String toString() {
        return "RefreshTokenRequest[REDACTED]";
    }
}
