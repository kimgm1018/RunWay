package com.runway.backend.domain.auth.dto;

import java.time.Instant;

public record RefreshResponse(
        String accessToken, String refreshToken, long expiresInSec, Instant refreshExpiresAt) {
    @Override
    public String toString() {
        return "RefreshResponse[REDACTED]";
    }
}
