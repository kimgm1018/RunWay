package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import java.time.Instant;

public record PostListItemResponse(
        long id,
        long authorId,
        long sessionId,
        @JsonInclude(JsonInclude.Include.ALWAYS) Long courseId,
        boolean courseShared,
        String body,
        String imageKey,
        String regionCode,
        Instant createdAt,
        String imageUrl,
        long commentCount,
        long reactionCount,
        @JsonInclude(JsonInclude.Include.ALWAYS) String myReaction,
        boolean bookmarked,
        PostAuthorResponse author,
        RecordSummaryResponse recordSummary) {

    public static PostListItemResponse from(
            Post post,
            PostAuthorResponse author,
            SessionShareInfo session,
            PostEngagement engagement) {
        return new PostListItemResponse(
                post.getId(),
                post.getAuthorId(),
                post.getSessionId(),
                engagement.courseId(),
                engagement.courseShared(),
                post.getBody(),
                post.getImageKey(),
                post.getRegionCode(),
                post.getCreatedAt(),
                null,
                engagement.commentCount(),
                engagement.reactionCount(),
                engagement.myReaction(),
                engagement.bookmarked(),
                author,
                RecordSummaryResponse.from(session));
    }
}
