package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.dto.request.UpdateProfileRequest;
import com.runway.backend.domain.user.dto.response.UpdatedUserProfileResponse;
import com.runway.backend.domain.user.dto.response.UserProfileResponse;
import com.runway.backend.domain.user.service.UserProfileService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users/me")
@RequiredArgsConstructor
public class UserProfileController {

    private final UserProfileService profiles;

    @GetMapping
    @Operation(summary = "본인 기본 프로필 조회")
    public UserProfileResponse read(@AuthenticationPrincipal AuthenticatedUser user) {
        return profiles.read(CurrentUserIdResolver.requireUserId(user));
    }

    @PatchMapping
    @Operation(summary = "본인 기본 프로필 부분 수정")
    public UpdatedUserProfileResponse update(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestBody UpdateProfileRequest request) {
        return profiles.update(CurrentUserIdResolver.requireUserId(user), request);
    }
}
