package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.CrewMembership;
import java.time.Instant;

public record MemberLeaveResponse(String status, Instant leftAt) {

    public static MemberLeaveResponse from(CrewMembership membership) {
        return new MemberLeaveResponse(membership.getStatus().name(), membership.getLeftAt());
    }
}
