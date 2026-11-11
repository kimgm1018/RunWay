package com.runway.backend.domain.crew.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;
import com.runway.backend.domain.image.ImageService;

// imageUrl: 크루 대표 사진 조회 주소(crews.image_key → F02), 없으면 null. S15P31E105-636.
public record CrewDetailResponse(
        long id,
        String name,
        String description,
        long ownerId,
        long memberCount,
        int capacity,
        String regionCode,
        String joinPolicy,
        String myMembershipStatus,
        @JsonInclude(JsonInclude.Include.ALWAYS) String imageUrl) {

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
                myMembershipStatus == null ? null : myMembershipStatus.name(),
                ImageService.publicUrlFromKey(crew.getImageKey()));
    }
}
