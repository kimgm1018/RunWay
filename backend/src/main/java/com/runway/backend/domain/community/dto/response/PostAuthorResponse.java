package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository.AuthorRow;
import com.runway.backend.domain.image.ImageService;

/**
 * 게시물·댓글 작성자 표시 정보. nickname·profileImageUrl은 없으면 null이며 키는 항상 포함한다. 사진 주소는 U21·U26/U27과
 * 같은 방식(users.profile_image_key → 공개 URL)으로 만든다.
 */
public record PostAuthorResponse(
        long userId,
        @JsonInclude(JsonInclude.Include.ALWAYS) String nickname,
        @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl) {

    public static PostAuthorResponse of(long userId, AuthorRow row) {
        if (row == null) {
            return new PostAuthorResponse(userId, null, null);
        }
        return new PostAuthorResponse(
                userId, row.nickname(), ImageService.publicUrlFromKey(row.profileImageKey()));
    }
}
