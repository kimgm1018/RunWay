package com.runway.backend.domain.session.entity;

import java.math.BigDecimal;
import java.time.Instant;

/** 분석 입력으로 읽은 W07 측정 샘플(running_metric_samples)의 필요한 값. 미측정 값은 null이다. */
public record AnalysisSample(
        Instant measuredAt, BigDecimal totalDistance, BigDecimal heartRate, BigDecimal cadence) {}
