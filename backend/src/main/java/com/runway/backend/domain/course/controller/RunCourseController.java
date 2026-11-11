package com.runway.backend.domain.course.controller;

import com.runway.backend.domain.course.service.RunCourseService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/running-records")
@RequiredArgsConstructor
public class RunCourseController {
    private final RunCourseService courses;

    @PutMapping("/{sessionId}/course")
    public RunCourseResponse save(@AuthenticationPrincipal AuthenticatedUser user,
                                  @PathVariable long sessionId) {
        return new RunCourseResponse(courses.save(CurrentUserIdResolver.requireUserId(user), sessionId));
    }

    public record RunCourseResponse(long courseId) {}
}
