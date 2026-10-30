package com.runway.backend.domain.auth.dto;

import java.time.Instant;

public record LoginResponse(
        User user,
        String accessToken,
        String refreshToken,
        long expiresInSec,
        Instant refreshExpiresAt,
        boolean onboardingCompleted) {
    public record User(long id, String loginId) {}

    @Override
    public String toString() {
        return "LoginResponse[REDACTED]";
    }
}
