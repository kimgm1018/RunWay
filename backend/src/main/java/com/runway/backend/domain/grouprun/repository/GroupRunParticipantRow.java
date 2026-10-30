package com.runway.backend.domain.grouprun.repository;

import java.time.Instant;

public record GroupRunParticipantRow(
        long id,
        long groupRunId,
        long userId,
        Long sessionId,
        Instant joinedAt,
        boolean ready) {}
