package com.runway.backend.domain.user.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.user.entity.RunningLevel;
import com.runway.backend.domain.user.entity.UserProfile;

import java.math.BigDecimal;
import java.time.Instant;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record RunningProfileResponse(
        RunningLevel selfReportedLevel,
        Integer baselineDistanceM,
        Integer baselineDurationSec,
        BigDecimal usualPaceSecPerKm,
        boolean onboardingCompleted,
        Instant updatedAt) {
    public static RunningProfileResponse from(UserProfile profile, boolean completed) {
        return new RunningProfileResponse(
                profile.getRunningLevel(),
                profile.getDistance(),
                profile.getDuration(),
                profile.getAveragePace(),
                completed,
                profile.getUpdatedAt());
    }
}
