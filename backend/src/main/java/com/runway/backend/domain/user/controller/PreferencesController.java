package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.dto.request.PreferencesRequest;
import com.runway.backend.domain.user.dto.response.PreferencesResponse;
import com.runway.backend.domain.user.service.PreferencesService;
import com.runway.backend.domain.user.validation.PreferencesValidator;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;

import io.swagger.v3.oas.annotations.Operation;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users/me/preferences")
@RequiredArgsConstructor
public class PreferencesController {
    private final PreferencesService preferences;
    private final PreferencesValidator validator;

    @GetMapping
    @Operation(summary = "본인 추천 기본값 조회")
    public PreferencesResponse read(@AuthenticationPrincipal AuthenticatedUser user) {
        return PreferencesResponse.from(
                preferences.read(CurrentUserIdResolver.requireUserId(user)));
    }

    @PutMapping
    @Operation(summary = "본인 추천 기본값 전체 저장")
    public PreferencesResponse save(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody PreferencesRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return PreferencesResponse.from(preferences.save(userId, validator.validate(request)));
    }
}
