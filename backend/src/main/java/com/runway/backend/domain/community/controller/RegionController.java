package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.response.RegionListResponse;
import com.runway.backend.domain.community.service.RegionService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/regions")
@RequiredArgsConstructor
public class RegionController {

    private final RegionService regionService;

    @GetMapping
    public RegionListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude) {
        CurrentUserIdResolver.requireUserId(user);
        return regionService.list(latitude, longitude);
    }
}
