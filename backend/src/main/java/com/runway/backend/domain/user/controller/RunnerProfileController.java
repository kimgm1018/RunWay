package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.service.RunnerProfileService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.constraints.Positive;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class RunnerProfileController {
    private final RunnerProfileService profiles;

    @GetMapping("/{userId}/profile")
    public RunnerProfileService.Profile read(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long userId) {
        return profiles.read(CurrentUserIdResolver.requireUserId(user), userId);
    }
}
