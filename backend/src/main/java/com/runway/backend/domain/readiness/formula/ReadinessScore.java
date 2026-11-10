package com.runway.backend.domain.readiness.formula;

import java.math.BigDecimal;

/**
 * 산식 결과. 항목 점수는 계산할 수 없으면 null이다.
 *
 * @param readinessScore 최종 준비도(0~100, 소수 둘째 자리)
 * @param restingHrChangePct R 계산에 쓴 평소 대비 오늘 안정시 심박 변화율(%, 소수 첫째 자리 +∞ 방향 올림). R이 없으면 null
 */
public record ReadinessScore(
        BigDecimal readinessScore,
        ReadinessConfidence confidence,
        BigDecimal sleepScore,
        BigDecimal recoveryScore,
        BigDecimal loadScore,
        BigDecimal restingHrChangePct) {}
