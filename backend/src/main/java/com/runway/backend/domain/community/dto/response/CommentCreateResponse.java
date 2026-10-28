package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Comment;
import java.time.Instant;

public record CommentCreateResponse(
        long id, long postId, long authorId, Long parentCommentId, String body, Instant createdAt) {

    public static CommentCreateResponse from(Comment comment) {
        return new CommentCreateResponse(
                comment.getId(),
                comment.getPostId(),
                comment.getAuthorId(),
                comment.getParentCommentId(),
                comment.getBody(),
                comment.getCreatedAt());
    }
}
