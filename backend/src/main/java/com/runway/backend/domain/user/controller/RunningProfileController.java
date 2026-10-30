package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.dto.request.RunningProfileRequest;
import com.runway.backend.domain.user.dto.response.RunningProfileResponse;
import com.runway.backend.domain.user.service.RunningProfileService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;

import io.swagger.v3.oas.annotations.Operation;

import jakarta.validation.Valid;

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
public class RunningProfileController {
    private final RunningProfileService profiles;

    @GetMapping("/running-profile")
    @Operation(summary = "본인 러닝 프로필 조회")
    public RunningProfileResponse readProfile(@AuthenticationPrincipal AuthenticatedUser user) {
        return profiles.readProfile(CurrentUserIdResolver.requireUserId(user));
    }

    @PatchMapping("/running-profile")
    @Operation(summary = "러닝 프로필 최초 저장 또는 부분 수정")
    public RunningProfileResponse saveProfile(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody RunningProfileRequest request) {
        return profiles.saveProfile(CurrentUserIdResolver.requireUserId(user), request);
    }
}
