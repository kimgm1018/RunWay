package com.runway.backend.domain.readiness.formula;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * 준비도 산식에 쓰는 하루치 건강값({@code daily_health_metrics}의 일부). 미측정은 null이며 0으로 바꾸지 않는다.
 *
 * @param sleepDurationMin 수면시간(분)
 * @param restingHrBpm 안정시 심박수(bpm)
 * @param dailyTrainingLoad 하루 운동 부하(Edwards TRIMP)
 */
public record DailyHealthInput(
        LocalDate metricDate,
        BigDecimal sleepDurationMin,
        BigDecimal restingHrBpm,
        BigDecimal dailyTrainingLoad) {}
