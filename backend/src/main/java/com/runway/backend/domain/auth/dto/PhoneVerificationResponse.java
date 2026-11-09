package com.runway.backend.domain.auth.dto;

/** U28 응답. */
public record PhoneVerificationResponse(long expiresInSec, long resendAvailableInSec) {}
