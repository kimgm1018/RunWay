package com.runway.backend.domain.session.controller;

import com.runway.backend.domain.session.dto.response.CoursePacePlanResponse;
import com.runway.backend.domain.session.service.CoursePacePlanPreview;
import com.runway.backend.global.security.AuthenticatedUser;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;

/** C12 출발 전 코스 페이스 계획 미리보기(S15P31E105-733). 계획 소유 도메인(세션)에 두고 코스 경로를 쓴다. */
@RestController
@RequestMapping("/api/v1/courses")
@RequiredArgsConstructor
public class CoursePacePlanController {
    private final CoursePacePlanPreview preview;

    @GetMapping("/{courseId}/pace-plan")
    public CoursePacePlanResponse pacePlan(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long courseId,
            @RequestParam(required = false) Integer targetDurationSec,
            @RequestParam(required = false) BigDecimal targetPaceSecPerKm) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return preview.preview(userId, courseId, targetDurationSec, targetPaceSecPerKm);
    }
}
