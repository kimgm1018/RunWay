package com.runway.backend.domain.grouprun.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

public record GroupRunParticipantsResponse(
        List<Item> items, int participantCount, int readyCount) {

    public record Item(
            long userId,
            Long sessionId,
            Instant joinedAt,
            String nickname,
            boolean isHost,
            String readyStatus,
            Integer readinessScore,
            // U21과 같은 프로필 사진 조회 주소, 없으면 null(S15P31E105-636).
            @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl) {}
}
