package com.runway.backend.domain.readiness.dto.response;

import com.runway.backend.domain.readiness.formula.ReadinessFormula;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.LatestReadinessRow;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.LoadWindow;
import java.math.RoundingMode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * R02 응답. readinessConfidence는 미산출이면 null로 포함한다(신뢰도이며 준비도 등급이 아니다). 건강 지표는 readinessDate와 같은 날짜의
 * 본인 일별 건강 행 값이며, 행이나 값이 없으면 null로 포함한다.
 *
 * @param readinessDate 준비도 기준일(워치 시간대 날짜). 클라이언트가 오늘 결과인지 판단한다
 * @param restingHrBpm 기준일 안정시 심박수(bpm)
 * @param restingHrSource 안정시 심박 출처(RUNWAY_WATCH·SAMSUNG_HEALTH, S15P31E105-600). 값이 없으면 null
 * @param sleepDurationMin 기준일 수면시간(분)
 * @param healthUpdatedAt 기준일 건강 행의 마지막 변경 시각(준비도 평가 시각이 아니다)
 * @param weeklyTrainingLoad readinessDate 기준 D-6~D 부하 합(S15P31E105-599). D-27~D에 부하 값이 없으면 null
 * @param usualWeeklyTrainingLoad 평소 주간 부하(28일 합 × 7 ÷ 이력 일수). D-27~D에 부하 값이 없으면 null
 */
public record ReadinessLatestResponse(
        long id,
        BigDecimal readinessScore,
        LocalDate readinessDate,
        String readinessConfidence,
        BigDecimal restingHrBpm,
        String restingHrSource,
        BigDecimal sleepDurationMin,
        Instant healthUpdatedAt,
        BigDecimal weeklyTrainingLoad,
        BigDecimal usualWeeklyTrainingLoad) {

    public static ReadinessLatestResponse from(LatestReadinessRow row) {
        LoadWindow load = row.load();
        BigDecimal weekly = null;
        BigDecimal usual = null;
        if (load != null) {
            weekly = load.weeklySum().setScale(2, RoundingMode.HALF_UP);
            usual =
                    ReadinessFormula.usualWeeklyLoad(
                            load.totalSum(),
                            ReadinessFormula.historyDays(row.readinessDate(), load.firstLoadDate()));
        }
        return new ReadinessLatestResponse(
                row.id(),
                row.readinessScore(),
                row.readinessDate(),
                row.confidence(),
                row.restingHrBpm(),
                row.restingHrSource(),
                row.sleepDurationMin(),
                row.healthUpdatedAt(),
                weekly,
                usual);
    }
}
