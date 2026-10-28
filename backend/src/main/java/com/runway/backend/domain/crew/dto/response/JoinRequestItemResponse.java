package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.CrewMembership;
import java.time.Instant;

public record JoinRequestItemResponse(
        long userId, String status, Instant requestedAt, Instant joinedAt, String nickname) {

    public static JoinRequestItemResponse from(CrewMembership membership, String nickname) {
        return new JoinRequestItemResponse(
                membership.getUserId(),
                membership.getStatus().name(),
                membership.getRequestedAt(),
                membership.getJoinedAt(),
                nickname);
    }
}
