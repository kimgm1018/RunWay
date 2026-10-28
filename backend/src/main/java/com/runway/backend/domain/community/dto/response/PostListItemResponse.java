package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import java.time.Instant;

public record PostListItemResponse(
        long id,
        long authorId,
        long sessionId,
        String body,
        String imageKey,
        String regionCode,
        Instant createdAt,
        String imageUrl,
        PostAuthorResponse author,
        RecordSummaryResponse recordSummary) {

    public static PostListItemResponse from(Post post, String nickname, SessionShareInfo session) {
        return new PostListItemResponse(
                post.getId(),
                post.getAuthorId(),
                post.getSessionId(),
                post.getBody(),
                post.getImageKey(),
                post.getRegionCode(),
                post.getCreatedAt(),
                null,
                new PostAuthorResponse(post.getAuthorId(), nickname),
                RecordSummaryResponse.from(session));
    }
}
