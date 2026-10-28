package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.Crew;
import java.time.Instant;

public record CrewCreateResponse(long id, long ownerId, String name, Instant createdAt) {

    public static CrewCreateResponse from(Crew crew) {
        return new CrewCreateResponse(
                crew.getId(), crew.getOwnerId(), crew.getName(), crew.getCreatedAt());
    }
}
