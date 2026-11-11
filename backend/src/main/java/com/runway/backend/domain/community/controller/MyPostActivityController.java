package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.response.PostListResponse;
import com.runway.backend.domain.community.repository.PostPageQueryRepository.Activity;
import com.runway.backend.domain.community.service.PostService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** CMT18 내 스크랩 목록·CMT19 내 좋아요 목록. 커뮤니티 API이며 본인 목록만 제공한다(다른 회원 목록 API 없음). */
@RestController
@RequestMapping("/api/v1/users/me")
@RequiredArgsConstructor
public class MyPostActivityController {

    private final PostService postService;

    @GetMapping("/bookmarks")
    public PostListResponse bookmarks(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.listMyActivity(userId, Activity.BOOKMARK, cursor, limit);
    }

    @GetMapping("/likes")
    public PostListResponse likes(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.listMyActivity(userId, Activity.LIKE, cursor, limit);
    }
}
