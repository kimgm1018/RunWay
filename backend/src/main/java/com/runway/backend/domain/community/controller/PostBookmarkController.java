package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.response.PostBookmarkResponse;
import com.runway.backend.domain.community.service.PostBookmarkService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** CMT16·CMT17 게시물 스크랩(저장) 등록·해제. */
@RestController
@RequestMapping("/api/v1/posts/{postId}/bookmarks/me")
@RequiredArgsConstructor
public class PostBookmarkController {

    private final PostBookmarkService postBookmarkService;

    @PutMapping
    public PostBookmarkResponse bookmark(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long postId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postBookmarkService.bookmark(userId, postId);
    }

    @DeleteMapping
    public PostBookmarkResponse unbookmark(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long postId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postBookmarkService.unbookmark(userId, postId);
    }
}
