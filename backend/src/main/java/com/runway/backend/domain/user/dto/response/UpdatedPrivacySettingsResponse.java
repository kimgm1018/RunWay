package com.runway.backend.domain.user.dto.response;

import java.time.Instant;

public record UpdatedPrivacySettingsResponse(boolean isPrivate, Instant updatedAt) {}
