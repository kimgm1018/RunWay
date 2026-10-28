package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import java.time.Instant;

public record PostDetailResponse(
        long id,
        String body,
        long authorId,
        long sessionId,
        Long courseId,
        String imageKey,
        String regionCode,
        Instant createdAt,
        Instant updatedAt,
        String imageUrl,
        PostAuthorResponse author,
        RecordSummaryResponse recordSummary) {

    public static PostDetailResponse from(Post post, String nickname, SessionShareInfo session) {
        Long courseId = session == null ? null : session.courseId();
        return new PostDetailResponse(
                post.getId(),
                post.getBody(),
                post.getAuthorId(),
                post.getSessionId(),
                courseId,
                post.getImageKey(),
                post.getRegionCode(),
                post.getCreatedAt(),
                post.getUpdatedAt(),
                null,
                new PostAuthorResponse(post.getAuthorId(), nickname),
                RecordSummaryResponse.from(session));
    }
}
