package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;
import java.util.List;

/**
 * H07 평균 페이스 추이. {@code changeSecPerKm}은 첫 달·마지막 달 페이스가 모두 있을 때만 마지막−첫 달, 아니면
 * null.
 */
public record RunningRecordPaceTrendResponse(
        List<RunningRecordPaceTrendItemResponse> items, BigDecimal changeSecPerKm) {}
