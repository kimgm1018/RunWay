package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.dto.response.UserSettingsResponse;
import com.runway.backend.domain.user.service.UserSettingsService;
import com.runway.backend.domain.user.validation.UserSettingsValidator;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;

import lombok.RequiredArgsConstructor;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users/me/settings")
@RequiredArgsConstructor
public class UserSettingsController {
    private final UserSettingsService settings;
    private final UserSettingsValidator validator;

    @GetMapping
    public UserSettingsResponse read(@AuthenticationPrincipal AuthenticatedUser user) {
        return settings.read(CurrentUserIdResolver.requireUserId(user));
    }

    @PatchMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public UserSettingsResponse update(
            @AuthenticationPrincipal AuthenticatedUser user, @RequestBody String body) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return settings.update(userId, validator.parse(body));
    }
}
