package com.runway.backend.domain.coaching.decide;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * 검증을 마친 AI04 응답의 판단 하나(ai-service.md "AI04 Response"). {@code decision}이 null인 응답은 이 값을 만들지 않는다.
 *
 * @param recommendedPaceSecPerKm 양수, 소수 둘째 자리
 * @param cueBpm 60~220. AI가 계산하지 못했으면 null(CUE_BPM_UNAVAILABLE)
 * @param predictedHr30Bpm 30초 뒤 예측 심박. 없으면 null
 */
public record PaceDecision(
        boolean publishSuggested,
        Action action,
        BigDecimal recommendedPaceSecPerKm,
        Integer cueBpm,
        BigDecimal predictedHr30Bpm,
        BigDecimal predictedHr60Bpm,
        BigDecimal predictedHr120Bpm,
        BigDecimal routeProgressM,
        long basedOnStateVersion,
        Instant expiresAt) {

    public enum Action {
        GUIDE_PACE,
        EASE_OFF,
        NOT_RUNNING
    }
}
