package com.runway.backend.domain.community.dto.request;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * CMT01 생성 요청. imageId는 수신만 하고 저장하지 않는다. courseShared 생략은 true이며, 세션에 코스가 없으면 값과 무관하게
 * false로 저장한다. body는 앱 작성 화면과 같은 500자까지다(S15P31E105-779).
 */
public record CreatePostRequest(
        @NotNull Long sessionId,
        @Size(max = 500) String body,
        @Size(max = 1024) String imageKey,
        @Size(max = 40) String regionCode,
        @Size(max = 36) String imageId,
        Boolean courseShared) {}
