package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Post;
import java.time.Instant;

/** CMT01 응답. 작성자 본인 응답이므로 courseId는 세션 코스 그대로이고 courseFromFreeRun도 숨기지 않는다. */
public record PostCreateResponse(
        long id,
        String body,
        long authorId,
        long sessionId,
        Long courseId,
        boolean courseFromFreeRun,
        boolean courseShared,
        Instant createdAt,
        String imageUrl,
        String courseShareFailureReason) {

    public static PostCreateResponse from(
            Post post, Long courseId, boolean courseFromFreeRun, String courseShareFailureReason) {
        return new PostCreateResponse(
                post.getId(),
                post.getBody(),
                post.getAuthorId(),
                post.getSessionId(),
                courseId,
                courseId != null && courseFromFreeRun,
                post.isCourseShared() && courseId != null,
                post.getCreatedAt(),
                null,
                courseShareFailureReason);
    }
}
