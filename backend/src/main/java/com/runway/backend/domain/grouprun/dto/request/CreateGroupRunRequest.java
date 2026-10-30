package com.runway.backend.domain.grouprun.dto.request;

import com.runway.backend.global.geo.GeoJsonPoint;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public record CreateGroupRunRequest(
        @NotBlank @Size(max = 100) String title,
        @Size(max = 10000) String description,
        @NotNull Long crewId,
        Long courseId,
        @NotNull Instant scheduledAt,
        @NotNull GeoJsonPoint meetingPosition,
        @NotBlank @Size(max = 200) String meetingPlaceName,
        @Size(max = 255) String meetingAddress,
        Integer targetDistanceM,
        String goalInputType,
        Integer targetDurationSec,
        Integer targetPaceSecPerKm) {}
