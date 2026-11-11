package com.runway.backend.domain.crew.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.crew.entity.CrewMembership;
import com.runway.backend.domain.crew.repository.UserExistsRepository.UserDisplay;
import java.time.Instant;

// profileImageUrl: U21과 같은 프로필 사진 조회 주소, 없으면 null(S15P31E105-636).
public record JoinRequestItemResponse(
        long userId,
        String status,
        Instant requestedAt,
        Instant joinedAt,
        String nickname,
        @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl) {

    public static JoinRequestItemResponse from(CrewMembership membership, UserDisplay user) {
        return new JoinRequestItemResponse(
                membership.getUserId(),
                membership.getStatus().name(),
                membership.getRequestedAt(),
                membership.getJoinedAt(),
                user == null ? null : user.nickname(),
                user == null ? null : user.profileImageUrl());
    }
}
