package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;

public record PatchGroupRunResponse(
        long id,
        String title,
        String status,
        Long courseId,
        Instant updatedAt,
        Instant scheduledAt,
        String meetingPlaceName,
        String meetingAddress,
        Integer targetDistanceM,
        Integer targetDurationSec,
        Integer goalPaceSecPerKm) {}
