package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.service.FollowListService;
import com.runway.backend.domain.user.service.FollowService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.constraints.Positive;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class FollowController {
    private final FollowService follows;
    private final FollowListService lists;

    @PutMapping("/{userId}/follow")
    public FollowService.Result follow(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long userId) {
        return follows.follow(CurrentUserIdResolver.requireUserId(user), userId);
    }

    @DeleteMapping("/{userId}/follow")
    public FollowService.Result cancel(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long userId) {
        return follows.cancel(CurrentUserIdResolver.requireUserId(user), userId);
    }

    // U26 · U27: approved followers and followings, 20 per page.
    @GetMapping("/{userId}/followers")
    public FollowListService.Page followers(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long userId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return lists.list(CurrentUserIdResolver.requireUserId(user), userId,
                FollowListService.Kind.FOLLOWERS, cursor, limit);
    }

    @GetMapping("/{userId}/following")
    public FollowListService.Page following(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long userId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return lists.list(CurrentUserIdResolver.requireUserId(user), userId,
                FollowListService.Kind.FOLLOWING, cursor, limit);
    }

    @GetMapping("/me/follow-requests")
    public FollowService.Page pending(@AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return follows.pending(CurrentUserIdResolver.requireUserId(user), cursor, limit);
    }

    @PatchMapping("/me/follow-requests/{requesterId}")
    public FollowService.Decision decide(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long requesterId, @RequestBody JsonNode body) {
        if (body == null || !body.isObject() || body.size() != 2
                || !body.has("requestId") || !body.has("decision")
                || !body.get("requestId").isIntegralNumber()
                || !body.get("requestId").canConvertToLong()
                || !body.get("decision").isString())
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        return follows.decide(CurrentUserIdResolver.requireUserId(user), requesterId,
                body.get("requestId").asLong(), body.get("decision").asString());
    }
}
