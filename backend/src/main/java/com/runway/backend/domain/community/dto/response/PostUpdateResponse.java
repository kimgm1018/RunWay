package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import java.time.Instant;

/** CMT04 응답. courseShared는 세션에 코스가 없으면 false다. */
public record PostUpdateResponse(long id, String body, boolean courseShared, Instant updatedAt) {

    public static PostUpdateResponse from(Post post, boolean courseShared) {
        return new PostUpdateResponse(post.getId(), post.getBody(), courseShared, post.getUpdatedAt());
    }
}
