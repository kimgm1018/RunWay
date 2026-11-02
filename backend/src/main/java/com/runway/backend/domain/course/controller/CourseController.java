package com.runway.backend.domain.course.controller;

import com.runway.backend.domain.course.dto.request.BookmarkCourseRequest;
import com.runway.backend.domain.course.dto.request.RecommendCoursesRequest;
import com.runway.backend.domain.course.dto.response.BookmarkCourseResponse;
import com.runway.backend.domain.course.dto.response.CourseDetailResponse;
import com.runway.backend.domain.course.dto.response.RecommendCoursesResponse;
import com.runway.backend.domain.course.dto.response.UnbookmarkCourseResponse;
import com.runway.backend.domain.course.service.CourseService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/courses")
@RequiredArgsConstructor
public class CourseController {

    private final CourseService courseService;

    @PostMapping("/recommendations")
    public RecommendCoursesResponse recommend(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody RecommendCoursesRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return courseService.recommend(userId, request);
    }

    @GetMapping("/{courseId}")
    public CourseDetailResponse getDetail(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long courseId,
            @RequestParam(required = false) Double targetPaceSecPerKm) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return courseService.getDetail(userId, courseId, targetPaceSecPerKm);
    }

    @PutMapping("/{courseId}/bookmark")
    public BookmarkCourseResponse bookmark(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long courseId,
            @RequestBody(required = false) BookmarkCourseRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return courseService.bookmark(userId, courseId, request);
    }

    @DeleteMapping("/{courseId}/bookmark")
    public UnbookmarkCourseResponse unbookmark(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long courseId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return courseService.unbookmark(userId, courseId);
    }
}
