package com.runway.backend.domain.course.controller;

import com.runway.backend.domain.course.dto.response.BookmarkedCourseListResponse;
import com.runway.backend.domain.course.service.CourseService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users/me/bookmarked-courses")
@RequiredArgsConstructor
public class BookmarkedCourseController {

    private final CourseService courseService;

    @GetMapping
    public BookmarkedCourseListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String difficulty) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return courseService.listBookmarkedCourses(userId, cursor, limit, difficulty);
    }
}
