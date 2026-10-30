package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewStatus;

public record CrewDissolveResponse(long id, CrewStatus status) {

    public static CrewDissolveResponse from(Crew crew) {
        return new CrewDissolveResponse(crew.getId(), crew.getStatus());
    }
}
