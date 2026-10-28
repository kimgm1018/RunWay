package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Comment;
import java.time.Instant;

public record CommentUpdateResponse(long id, String body, Instant updatedAt) {

    public static CommentUpdateResponse from(Comment comment) {
        return new CommentUpdateResponse(
                comment.getId(), comment.getBody(), comment.getUpdatedAt());
    }
}
