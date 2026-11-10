package com.runway.backend.domain.community.dto.response;

/** CMT16 스크랩 등록·CMT17 스크랩 해제 응답. 처리 후 조회자의 저장 상태를 준다. */
public record PostBookmarkResponse(long postId, boolean bookmarked) {}
