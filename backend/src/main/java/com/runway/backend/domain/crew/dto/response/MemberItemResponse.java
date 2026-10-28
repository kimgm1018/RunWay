package com.runway.backend.domain.crew.dto.response;

import com.runway.backend.domain.crew.entity.CrewMembership;
import java.time.Instant;

public record MemberItemResponse(
        long userId, String status, Instant joinedAt, String nickname, boolean isOwner) {

    public static MemberItemResponse from(
            CrewMembership membership, String nickname, boolean isOwner) {
        return new MemberItemResponse(
                membership.getUserId(),
                membership.getStatus().name(),
                membership.getJoinedAt(),
                nickname,
                isOwner);
    }
}
