package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import java.time.Instant;

public record PostDetailResponse(
        long id,
        String body,
        long authorId,
        long sessionId,
        @JsonInclude(JsonInclude.Include.ALWAYS) Long courseId,
        boolean courseShared,
        String imageKey,
        String regionCode,
        Instant createdAt,
        Instant updatedAt,
        String imageUrl,
        long commentCount,
        long reactionCount,
        @JsonInclude(JsonInclude.Include.ALWAYS) String myReaction,
        boolean bookmarked,
        PostAuthorResponse author,
        RecordSummaryResponse recordSummary) {

    public static PostDetailResponse from(
            Post post,
            PostAuthorResponse author,
            SessionShareInfo session,
            PostEngagement engagement) {
        return new PostDetailResponse(
                post.getId(),
                post.getBody(),
                post.getAuthorId(),
                post.getSessionId(),
                engagement.courseId(),
                engagement.courseShared(),
                post.getImageKey(),
                post.getRegionCode(),
                post.getCreatedAt(),
                post.getUpdatedAt(),
                null,
                engagement.commentCount(),
                engagement.reactionCount(),
                engagement.myReaction(),
                engagement.bookmarked(),
                author,
                RecordSummaryResponse.from(session));
    }
}
