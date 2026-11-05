package com.runway.backend.domain.grouprun.repository;

import java.time.Instant;

public record GroupRunRow(
        long id,
        long crewId,
        long hostId,
        Long courseId,
        String title,
        String description,
        Instant scheduledAt,
        String meetingName,
        String meetingAddress,
        String meetingPositionGeoJson,
        Integer goalDistance,
        Integer goalDuration,
        String status,
        String cancelReason,
        Instant createdAt,
        Instant updatedAt) {}
