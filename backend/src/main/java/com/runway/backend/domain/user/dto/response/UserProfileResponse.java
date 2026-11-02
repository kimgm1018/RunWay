package com.runway.backend.domain.user.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record UserProfileResponse(
        long id,
        String nickname,
        String gender,
        LocalDate birthDate,
        String loginId,
        String status,
        String profileImageUrl,
        boolean onboardingCompleted) {}
