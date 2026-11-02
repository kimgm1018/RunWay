package com.runway.backend.domain.readiness.dto.response;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.LatestReadinessRow;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * R02 응답. readinessConfidence는 미산출이면 null로 포함한다(신뢰도이며 준비도 등급이 아니다).
 *
 * @param readinessDate 준비도 기준일(워치 시간대 날짜). 클라이언트가 오늘 결과인지 판단한다
 */
public record ReadinessLatestResponse(
        long id, BigDecimal readinessScore, LocalDate readinessDate, String readinessConfidence) {

    public static ReadinessLatestResponse from(LatestReadinessRow row) {
        return new ReadinessLatestResponse(
                row.id(), row.readinessScore(), row.readinessDate(), row.confidence());
    }
}
