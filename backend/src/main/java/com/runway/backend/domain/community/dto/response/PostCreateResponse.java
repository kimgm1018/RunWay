package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import java.time.Instant;

public record PostCreateResponse(
        long id,
        String body,
        long authorId,
        long sessionId,
        Long courseId,
        Instant createdAt,
        String imageUrl) {

    public static PostCreateResponse from(Post post, Long courseId) {
        return new PostCreateResponse(
                post.getId(),
                post.getBody(),
                post.getAuthorId(),
                post.getSessionId(),
                courseId,
                post.getCreatedAt(),
                null);
    }
}
