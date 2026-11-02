package com.runway.backend.domain.user.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.time.LocalDate;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record UpdatedUserProfileResponse(
        long id,
        String nickname,
        String gender,
        LocalDate birthDate,
        Instant updatedAt,
        String profileImageUrl,
        boolean onboardingCompleted) {}
