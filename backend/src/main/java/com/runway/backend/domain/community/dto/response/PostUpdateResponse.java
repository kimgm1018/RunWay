package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import java.time.Instant;

public record PostUpdateResponse(long id, String body, Instant updatedAt) {

    public static PostUpdateResponse from(Post post) {
        return new PostUpdateResponse(post.getId(), post.getBody(), post.getUpdatedAt());
    }
}
