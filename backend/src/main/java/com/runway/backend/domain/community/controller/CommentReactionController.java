package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.request.UpsertReactionRequest;
import com.runway.backend.domain.community.dto.response.CommentReactionResponse;
import com.runway.backend.domain.community.service.CommentLikeService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class CommentReactionController {

    private final CommentLikeService commentLikeService;

    @PutMapping("/api/v1/comments/{commentId}/reactions/me")
    public CommentReactionResponse upsert(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long commentId,
            @RequestBody(required = false) UpsertReactionRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return commentLikeService.upsert(userId, commentId, request);
    }

    @DeleteMapping("/api/v1/comments/{commentId}/reactions/me")
    public CommentReactionResponse delete(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long commentId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return commentLikeService.delete(userId, commentId);
    }
}
