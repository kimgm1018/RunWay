package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.entity.Comment;
import java.time.Instant;

/**
 * CMT06 댓글 항목. 삭제된 원댓글 자리({@code deleted=true})는 authorId·body·author가 null, reactionCount 0, myReaction
 * null이다. nullable 필드도 키는 항상 포함한다.
 */
public record CommentListItemResponse(
        long id,
        long postId,
        @JsonInclude(JsonInclude.Include.ALWAYS) Long authorId,
        @JsonInclude(JsonInclude.Include.ALWAYS) Long parentCommentId,
        @JsonInclude(JsonInclude.Include.ALWAYS) String body,
        Instant createdAt,
        @JsonInclude(JsonInclude.Include.ALWAYS) PostAuthorResponse author,
        boolean deleted,
        long reactionCount,
        @JsonInclude(JsonInclude.Include.ALWAYS) String myReaction) {

    private static final String LIKE = "LIKE";

    public static CommentListItemResponse from(
            Comment comment, PostAuthorResponse author, long reactionCount, boolean liked) {
        return new CommentListItemResponse(
                comment.getId(),
                comment.getPostId(),
                comment.getAuthorId(),
                comment.getParentCommentId(),
                comment.getBody(),
                comment.getCreatedAt(),
                author,
                false,
                reactionCount,
                liked ? LIKE : null);
    }

    /** 삭제됐지만 삭제되지 않은 대댓글이 남은 원댓글 자리. 작성자·본문·반응을 내보내지 않는다. */
    public static CommentListItemResponse deletedPlaceholder(Comment comment) {
        return new CommentListItemResponse(
                comment.getId(),
                comment.getPostId(),
                null,
                comment.getParentCommentId(),
                null,
                comment.getCreatedAt(),
                null,
                true,
                0,
                null);
    }
}
