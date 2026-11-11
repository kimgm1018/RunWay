package com.runway.backend.domain.crew.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;
import com.runway.backend.domain.image.ImageService;

// imageUrl: 크루 대표 사진 조회 주소(crews.image_key → F02), 없으면 null. S15P31E105-636.
public record MyCrewItemResponse(
        long id,
        String name,
        String regionCode,
        String myMembershipStatus,
        long memberCount,
        boolean isOwner,
        @JsonInclude(JsonInclude.Include.ALWAYS) String imageUrl) {

    public static MyCrewItemResponse from(
            Crew crew, CrewMembershipStatus membershipStatus, long memberCount, long userId) {
        return new MyCrewItemResponse(
                crew.getId(),
                crew.getName(),
                crew.getRegionCode(),
                membershipStatus.name(),
                memberCount,
                crew.isOwnedBy(userId),
                ImageService.publicUrlFromKey(crew.getImageKey()));
    }
}
