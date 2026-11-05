package com.runway.backend.domain.grouprun.dto.response;

import com.runway.backend.global.geo.GeoJsonPoint;
import java.time.Instant;

public record GroupRunDetailResponse(
        long id,
        String title,
        String description,
        long hostId,
        long crewId,
        Long courseId,
        Instant scheduledAt,
        GeoJsonPoint meetingPosition,
        int participantCount,
        String status,
        Integer targetDistanceM,
        Integer targetDurationSec,
        String meetingPlaceName,
        String meetingAddress,
        Integer goalPaceSecPerKm,
        Integer groupGuidePaceSecPerKm,
        Cancellation cancellation) {

    /**
     * 취소된 그룹런의 취소 정보(G03). 취소되지 않은 그룹은 응답의 {@code cancellation}이 null이다. {@code message}는 알림 전용이라 저장하지 않으므로 항상
     * null이고, {@code byRole}은 {@code host_id} 기준 {@code HOST}다.
     */
    public record Cancellation(String reason, String message, String byNickname, String byRole) {}
}
