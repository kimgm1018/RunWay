package com.runway.backend.domain.user.personalization;

import java.time.Instant;
import java.util.List;

/**
 * AI06 요청의 {@code sessions[]} 원소. 변환기가 러닝 하나를 5초 격자로 바꾼 결과다.
 *
 * @param sessionId 양수 서버 세션 ID
 * @param sessionStartedAt 첫 유효 HR 시각(UTC)
 * @param workoutQuality 러닝 품질
 * @param samples 5초 간격 표본 25..1441개, {@code elapsedSec}는 0부터
 */
public record Ai06Session(
        long sessionId,
        Instant sessionStartedAt,
        WorkoutQuality workoutQuality,
        List<Ai06Sample> samples) {

    /** AI06 {@code workoutQuality} enum. */
    public enum WorkoutQuality {
        CLEAN,
        USABLE_WITH_FLAGS,
        UNUSABLE
    }

    @Override
    public String toString() {
        return "Ai06Session[sessionId=" + sessionId + ", REDACTED]";
    }
}
