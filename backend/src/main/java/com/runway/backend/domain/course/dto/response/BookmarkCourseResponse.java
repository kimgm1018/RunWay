package com.runway.backend.domain.course.dto.response;

import java.time.Instant;

public record BookmarkCourseResponse(String alias, Instant createdAt, boolean bookmarked) {}
