package com.runway.backend.domain.course.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record BookmarkedCourseListResponse(List<BookmarkedCourseItemResponse> items, String page) {}
