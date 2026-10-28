package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.CrewMembership;

public record DecideJoinResponse(long crewId, long userId, String status) {

    public static DecideJoinResponse from(CrewMembership membership) {
        return new DecideJoinResponse(
                membership.getCrewId(), membership.getUserId(), membership.getStatus().name());
    }
}
