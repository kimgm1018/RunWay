package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;

public record CrewDetailResponse(
        long id,
        String name,
        String description,
        long ownerId,
        long memberCount,
        int capacity,
        String regionCode,
        String joinPolicy,
        String myMembershipStatus) {

    public static CrewDetailResponse from(
            Crew crew, long memberCount, CrewMembershipStatus myMembershipStatus) {
        return new CrewDetailResponse(
                crew.getId(),
                crew.getName(),
                crew.getDescription(),
                crew.getOwnerId(),
                memberCount,
                crew.getCapacity(),
                crew.getRegionCode(),
                crew.getJoinPolicy().name(),
                myMembershipStatus == null ? null : myMembershipStatus.name());
    }
}
