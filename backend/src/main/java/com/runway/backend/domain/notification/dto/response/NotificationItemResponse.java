package com.runway.backend.domain.notification.dto.response;

import java.time.Instant;

public record NotificationItemResponse(
        long id, String kind, String message, Instant createdAt, boolean read, long targetId) {}
