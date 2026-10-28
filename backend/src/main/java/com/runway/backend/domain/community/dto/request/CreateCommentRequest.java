package com.runway.backend.domain.community.dto.request;

/** CMT07 작성 요청. parentCommentId는 1단 대댓글용 optional. */
public record CreateCommentRequest(String body, Long parentCommentId) {}
