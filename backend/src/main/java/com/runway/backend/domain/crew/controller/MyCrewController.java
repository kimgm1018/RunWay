package com.runway.backend.domain.crew.controller;

import com.runway.backend.domain.crew.dto.response.MyCrewListResponse;
import com.runway.backend.domain.crew.service.CrewService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users/me/crews")
@RequiredArgsConstructor
public class MyCrewController {

    private final CrewService crewService;

    @GetMapping
    public MyCrewListResponse listMyCrews(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String membershipStatus) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.listMyCrews(userId, membershipStatus);
    }
}
