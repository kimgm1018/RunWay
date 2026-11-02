package com.runway.backend.domain.readiness.formula;

/** {@code daily_readiness.readiness_confidence}. 계산에 쓴 항목(수면·회복·부하) 수에 따른 신뢰 수준이며 준비도 등급이 아니다. */
public enum ReadinessConfidence {
    LOW,
    MEDIUM,
    HIGH;

    static ReadinessConfidence ofComponentCount(int count) {
        return switch (count) {
            case 1 -> LOW;
            case 2 -> MEDIUM;
            case 3 -> HIGH;
            default -> throw new IllegalArgumentException("component count must be 1..3");
        };
    }
}
