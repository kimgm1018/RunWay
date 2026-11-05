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
        ComfortRange comfortRange,
        MyFit myFit) {

    /** 참가자 편한 페이스 범위(sec/km). fastSecPerKm &lt;= slowSecPerKm이며 값이 작을수록 빠르다. */
    public record ComfortRange(int fastSecPerKm, int slowSecPerKm) {}

    /** 요청자 본인의 최근 페이스와 최신 준비도. readinessScore는 미산출·미동의면 null. */
    public record MyFit(int recentPaceSecPerKm, Integer readinessScore) {}
}
