package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;

/** CMT13 users[] 항목. profileImageUrl은 사진이 없으면 null이며 키는 항상 포함한다. */
public record SearchUserItemResponse(
        long userId,
        String nickname,
        @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl) {}
