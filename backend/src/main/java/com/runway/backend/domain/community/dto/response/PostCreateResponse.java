package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import java.time.Instant;

/** CMT01 응답. 작성자 본인 응답이므로 courseId는 세션 코스 그대로다. */
public record PostCreateResponse(
        long id,
        String body,
        long authorId,
        long sessionId,
        Long courseId,
        boolean courseShared,
        Instant createdAt,
        String imageUrl,
        String courseShareFailureReason) {

    public static PostCreateResponse from(Post post, Long courseId) {
        return from(post, courseId, null);
    }

    public static PostCreateResponse from(Post post, Long courseId, String courseShareFailureReason) {
        return new PostCreateResponse(
                post.getId(),
                post.getBody(),
                post.getAuthorId(),
                post.getSessionId(),
                courseId,
                post.isCourseShared() && courseId != null,
                post.getCreatedAt(),
                null,
                courseShareFailureReason);
    }
}
