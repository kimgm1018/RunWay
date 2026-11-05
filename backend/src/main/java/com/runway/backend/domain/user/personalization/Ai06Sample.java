package com.runway.backend.domain.user.personalization;

/**
 * AI06 요청의 {@code samples[]} 원소. 값이 없으면 null이며 해당 품질은 {@link Quality#MISSING}이다. null도 JSON에 그대로
 * 내보낸다(필수 키).
 */
public record Ai06Sample(
        int elapsedSec,
        Double hrBpm,
        Double speedMps,
        Double gradePercent,
        Quality hrQuality,
        Quality speedQuality,
        Quality gradeQuality,
        boolean hrIsFilled) {

    /** AI06 지표 품질 enum. */
    public enum Quality {
        GOOD,
        LOW,
        MISSING
    }

    @Override
    public String toString() {
        return "Ai06Sample[REDACTED]";
    }
}
