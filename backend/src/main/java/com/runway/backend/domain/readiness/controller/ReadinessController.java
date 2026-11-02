package com.runway.backend.domain.readiness.controller;

import com.runway.backend.domain.readiness.dto.response.ReadinessLatestResponse;
import com.runway.backend.domain.readiness.service.ReadinessQueryService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 운동 준비도(readiness.md). 평가는 W06 이후 서버가 자동으로 하며 공개 평가 요청 API는 없다. */
@RestController
@RequestMapping("/api/v1/readiness-assessments")
@RequiredArgsConstructor
public class ReadinessController {

    private final ReadinessQueryService readinessQueryService;

    /** R02 본인의 최신 준비도 조회. */
    @GetMapping("/latest")
    public ReadinessLatestResponse latest(@AuthenticationPrincipal AuthenticatedUser user) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return readinessQueryService.getLatest(userId);
    }
}
