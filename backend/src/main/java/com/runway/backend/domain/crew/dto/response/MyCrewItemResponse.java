package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;

public record MyCrewItemResponse(
        long id,
        String name,
        String regionCode,
        String myMembershipStatus,
        long memberCount,
        boolean isOwner) {

    public static MyCrewItemResponse from(
            Crew crew, CrewMembershipStatus membershipStatus, long memberCount, long userId) {
        return new MyCrewItemResponse(
                crew.getId(),
                crew.getName(),
                crew.getRegionCode(),
                membershipStatus.name(),
                memberCount,
                crew.isOwnedBy(userId));
    }
}
