package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;
import java.util.List;

public record GroupRunParticipantsResponse(List<Item> items) {

    public record Item(
            long userId,
            Long sessionId,
            Instant joinedAt,
            String nickname,
            boolean isHost,
            String readyStatus,
            Integer readinessScore) {}
}
