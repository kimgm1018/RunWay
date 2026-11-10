package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * CMT02 게시물 목록, CMT18 내 스크랩 목록, CMT19 내 좋아요 목록의 공통 페이지 응답. 다음 페이지가 없으면 {@code nextCursor}는 null이고
 * {@code hasNext}는 false다.
 */
public record PostListResponse(
        List<PostListItemResponse> items,
        @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor,
        boolean hasNext) {

    public PostListResponse {
        items = List.copyOf(items);
    }

    public static PostListResponse lastPage(List<PostListItemResponse> items) {
        return new PostListResponse(items, null, false);
    }
}
