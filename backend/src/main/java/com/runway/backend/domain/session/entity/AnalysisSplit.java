package com.runway.backend.domain.session.entity;

import java.math.BigDecimal;

/**
 * running_session_splits 한 행. 마지막 구간은 1km보다 짧을 수 있다. 페이스·심박·케이던스는 계산할 수 없으면 null이다.
 *
 * @param startDistance 구간 시작거리(m)
 * @param endDistance 구간 종료거리(m)
 * @param pace 구간 페이스(초/km)
 */
public record AnalysisSplit(
        BigDecimal startDistance,
        BigDecimal endDistance,
        BigDecimal pace,
        BigDecimal averageHeartRate,
        BigDecimal averageCadence) {}
