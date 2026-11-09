package com.runway.backend.domain.auth.dto;

/** U29 응답. 증명은 로그에 남기지 않는다. */
public record PhoneVerificationConfirmResponse(String verificationToken, long expiresInSec) {
    @Override
    public String toString() {
        return "PhoneVerificationConfirmResponse[REDACTED]";
    }
}
