package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;

/** CMT14·CMT15 응답. reactionCount는 처리 직후 댓글의 좋아요 수, myReaction은 "LIKE" 또는 null(키 항상 포함). */
public record CommentReactionResponse(
        long commentId,
        long reactionCount,
        @JsonInclude(JsonInclude.Include.ALWAYS) String myReaction) {}
