package com.runway.backend.domain.community.repository;

/** 댓글별 집계 결과 projection. */
public interface CommentCount {

    Long getCommentId();

    long getTotal();
}
