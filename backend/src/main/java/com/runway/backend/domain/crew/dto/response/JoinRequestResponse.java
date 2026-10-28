package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.CrewMembership;
import java.time.Instant;

public record JoinRequestResponse(long crewId, long userId, String status, Instant requestedAt) {

    public static JoinRequestResponse from(CrewMembership membership) {
        return new JoinRequestResponse(
                membership.getCrewId(),
                membership.getUserId(),
                membership.getStatus().name(),
                membership.getRequestedAt());
    }
}
