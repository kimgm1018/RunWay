package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;

public record CreateGroupRunResponse(
        long id,
        long hostId,
        String status,
        Long courseId,
        Integer targetDistanceM,
        Integer targetDurationSec,
        Instant scheduledAt,
        String meetingPlaceName,
        String meetingAddress,
        Integer goalPaceSecPerKm) {}
