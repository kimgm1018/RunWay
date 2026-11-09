package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;

public record CrewSummaryResponse(
        long id,
        String name,
        String description,
        long ownerId,
        int capacity,
        String status,
        String regionCode,
        String joinPolicy,
        long memberCount,
        String myMembershipStatus) {

    public static CrewSummaryResponse from(
            Crew crew, long memberCount, CrewMembershipStatus myMembershipStatus) {
        return new CrewSummaryResponse(
                crew.getId(),
                crew.getName(),
                crew.getDescription(),
                crew.getOwnerId(),
                crew.getCapacity(),
                crew.getStatus().name(),
                crew.getRegionCode(),
                crew.getJoinPolicy().name(),
                memberCount,
                myMembershipStatus == null ? null : myMembershipStatus.name());
    }
}
