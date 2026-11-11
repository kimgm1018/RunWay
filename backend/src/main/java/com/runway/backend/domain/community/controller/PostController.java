package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.request.CreatePostRequest;
import com.runway.backend.domain.community.dto.request.UpdatePostRequest;
import com.runway.backend.domain.community.dto.response.PostCreateResponse;
import com.runway.backend.domain.community.dto.response.PostDeleteResponse;
import com.runway.backend.domain.community.dto.response.PostDetailResponse;
import com.runway.backend.domain.community.dto.response.PostListResponse;
import com.runway.backend.domain.community.dto.response.PostUpdateResponse;
import com.runway.backend.domain.community.service.PostService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/posts")
@RequiredArgsConstructor
public class PostController {

    private final PostService postService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PostCreateResponse create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody CreatePostRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.create(userId, request);
    }

    @GetMapping
    public PostListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String scope,
            @RequestParam(required = false) Long authorId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.list(userId, scope, authorId, cursor, limit);
    }

    @GetMapping("/{postId}")
    public PostDetailResponse getDetail(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long postId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.getDetail(userId, postId);
    }

    @PatchMapping("/{postId}")
    public PostUpdateResponse update(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long postId,
            @Valid @RequestBody UpdatePostRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.update(userId, postId, request);
    }

    @DeleteMapping("/{postId}")
    public PostDeleteResponse delete(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long postId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postService.delete(userId, postId);
    }
}
