package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.request.UpsertReactionRequest;
import com.runway.backend.domain.community.dto.response.ReactionUpsertResponse;
import com.runway.backend.domain.community.service.PostLikeService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class PostReactionController {

    private final PostLikeService postLikeService;

    @PutMapping("/api/v1/posts/{postId}/reactions/me")
    public ReactionUpsertResponse upsert(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long postId,
            @RequestBody(required = false) UpsertReactionRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postLikeService.upsert(userId, postId, request);
    }

    @DeleteMapping("/api/v1/posts/{postId}/reactions/me")
    public Map<String, Object> delete(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long postId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return postLikeService.delete(userId, postId);
    }
}
