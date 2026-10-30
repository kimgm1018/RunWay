package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;
import java.util.List;

public record GroupRunListResponse(List<Item> items, String nextCursor) {

    public record Item(
            long id,
            String title,
            long hostId,
            Long courseId,
            Instant scheduledAt,
            String status,
            Integer goalDistance,
            Integer goalDuration) {}
}
