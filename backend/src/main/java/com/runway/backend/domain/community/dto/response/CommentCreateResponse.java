package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.entity.Comment;
import java.time.Instant;

/** CMT07 응답. CMT06 항목과 같은 형태이며 새 댓글이므로 deleted=false, reactionCount=0, myReaction=null이다. */
public record CommentCreateResponse(
        long id,
        long postId,
        long authorId,
        @JsonInclude(JsonInclude.Include.ALWAYS) Long parentCommentId,
        String body,
        Instant createdAt,
        PostAuthorResponse author,
        boolean deleted,
        long reactionCount,
        @JsonInclude(JsonInclude.Include.ALWAYS) String myReaction) {

    public static CommentCreateResponse from(Comment comment, PostAuthorResponse author) {
        return new CommentCreateResponse(
                comment.getId(),
                comment.getPostId(),
                comment.getAuthorId(),
                comment.getParentCommentId(),
                comment.getBody(),
                comment.getCreatedAt(),
                author,
                false,
                0,
                null);
    }
}
