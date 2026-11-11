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
        Cancellation cancellation,
        ComfortRange comfortRange,
        MyFit myFit,
        String groupPaceMode,
        Integer aiRecommendedPaceSecPerKm,
        PaceBasis paceBasis,
        Boolean paceCalculating,
        Integer slowerThanGoalCount) {

    /**
     * 적용 공동 페이스의 근거(S15P31E105-680). type: MEMBER(AI 추천 회원), GOAL(목표 페이스), MEDIAN(계산 전 중앙값 대체). nickname은
     * AI 추천의 기준 회원이며 type이 GOAL이어도 AI 추천이 있으면 채운다.
     */
    public record PaceBasis(String type, String nickname) {}

    /**
     * 취소된 그룹런의 취소 정보(G03). 취소되지 않은 그룹은 응답의 {@code cancellation}이 null이다. {@code message}는 알림 전용이라 저장하지 않으므로 항상
     * null이고, {@code byRole}은 {@code host_id} 기준 {@code HOST}다.
     */
    public record Cancellation(String reason, String message, String byNickname, String byRole) {}

    /** 참가자 편한 페이스 범위(sec/km). fastSecPerKm &lt;= slowSecPerKm이며 값이 작을수록 빠르다. */
    public record ComfortRange(int fastSecPerKm, int slowSecPerKm) {}

    /** 요청자 본인의 최근 페이스와 최신 준비도. readinessScore는 미산출·미동의면 null. */
    public record MyFit(int recentPaceSecPerKm, Integer readinessScore) {}
}
