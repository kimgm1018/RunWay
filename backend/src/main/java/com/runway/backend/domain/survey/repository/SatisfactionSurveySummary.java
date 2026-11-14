package com.runway.backend.domain.survey.repository;

import java.math.BigDecimal;

/**
 * 기간 집계 결과. 응답이 없으면 responseCount=0, averageScore=null. averageScore는 소수 둘째 자리 반올림.
 * 응답자 기준 집계({@code summarizeByRespondent})에서는 responseCount가 응답자 수다.
 */
public record SatisfactionSurveySummary(long responseCount, BigDecimal averageScore) {}
