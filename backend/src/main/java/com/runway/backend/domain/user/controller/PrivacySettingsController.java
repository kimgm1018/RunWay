package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.dto.response.PrivacySettingsResponse;
import com.runway.backend.domain.user.dto.response.UpdatedPrivacySettingsResponse;
import com.runway.backend.domain.user.service.PrivacySettingsService;
import com.runway.backend.domain.user.validation.PrivacySettingsValidator;
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
@RequestMapping("/api/v1/users/me/privacy-settings")
@RequiredArgsConstructor
public class PrivacySettingsController {
    private final PrivacySettingsService settings;
    private final PrivacySettingsValidator validator;

    @GetMapping
    public PrivacySettingsResponse read(@AuthenticationPrincipal AuthenticatedUser user) {
        return settings.read(CurrentUserIdResolver.requireUserId(user));
    }

    @PatchMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public UpdatedPrivacySettingsResponse update(
            @AuthenticationPrincipal AuthenticatedUser user, @RequestBody String body) {
        return settings.update(CurrentUserIdResolver.requireUserId(user), validator.parse(body));
    }
}
