package com.runway.backend.domain.readiness.dto.response;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.LatestReadinessRow;
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
 */
public record ReadinessLatestResponse(
        long id,
        BigDecimal readinessScore,
        LocalDate readinessDate,
        String readinessConfidence,
        BigDecimal restingHrBpm,
        String restingHrSource,
        BigDecimal sleepDurationMin,
        Instant healthUpdatedAt) {

    public static ReadinessLatestResponse from(LatestReadinessRow row) {
        return new ReadinessLatestResponse(
                row.id(),
                row.readinessScore(),
                row.readinessDate(),
                row.confidence(),
                row.restingHrBpm(),
                row.restingHrSource(),
                row.sleepDurationMin(),
                row.healthUpdatedAt());
    }
}
