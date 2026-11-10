package com.runway.backend.domain.community.repository;

/** 게시물별 집계 결과 projection. */
public interface PostCount {

    Long getPostId();

    long getTotal();
}
