package com.runway.backend.domain.crew.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.crew.entity.CrewMembership;
import com.runway.backend.domain.crew.repository.UserExistsRepository.UserDisplay;
import java.time.Instant;

// profileImageUrl: U21과 같은 프로필 사진 조회 주소, 없으면 null(S15P31E105-636).
public record MemberItemResponse(
        long userId,
        String status,
        Instant joinedAt,
        String nickname,
        boolean isOwner,
        @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl) {

    public static MemberItemResponse from(
            CrewMembership membership, UserDisplay user, boolean isOwner) {
        return new MemberItemResponse(
                membership.getUserId(),
                membership.getStatus().name(),
                membership.getJoinedAt(),
                user == null ? null : user.nickname(),
                isOwner,
                user == null ? null : user.profileImageUrl());
    }
}
