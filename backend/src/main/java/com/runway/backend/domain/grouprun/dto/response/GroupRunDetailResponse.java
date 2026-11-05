package com.runway.backend.domain.grouprun.dto.response;

import com.runway.backend.global.geo.GeoJsonPoint;
import java.time.Instant;

public record GroupRunDetailResponse(
        long id,
        String title,
        String description,
        long hostId,
        long crewId,
        Long courseId,
        Instant scheduledAt,
        GeoJsonPoint meetingPosition,
        int participantCount,
        String status,
        Integer targetDistanceM,
        Integer targetDurationSec,
        String meetingPlaceName,
        String meetingAddress,
        Integer goalPaceSecPerKm,
        Integer groupGuidePaceSecPerKm) {}
