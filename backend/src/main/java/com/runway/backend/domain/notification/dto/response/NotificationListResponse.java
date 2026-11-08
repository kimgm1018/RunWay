package com.runway.backend.domain.notification.dto.response;

import java.util.List;

public record NotificationListResponse(
        List<NotificationItemResponse> items,
        String nextCursor,
        boolean hasNext,
        long unreadCount) {}
