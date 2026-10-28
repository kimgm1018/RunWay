package com.runway.backend.domain.community.dto.response;

import java.util.List;

public record CommentListResponse(List<CommentListItemResponse> items) {}
