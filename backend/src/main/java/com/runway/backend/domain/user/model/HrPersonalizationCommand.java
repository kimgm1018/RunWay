package com.runway.backend.domain.user.model;

import java.math.BigDecimal;

/**
 * AI06 성공 응답에서 저장할 심박 개인화 값. warnings, gruPersonalization, AI06 createdAt은 저장하지 않는다.
 *
 * <p>JSON 필드는 이미 직렬화된 JSON 문자열이며 {@code jsonb}로 저장한다. {@code hrDangerBpm}은 AI가 준 개인 P98 원값 그대로(+3
 * 전)이다.
 *
 * @param schemaVersion 개인화 JSON 스키마 버전
 * @param modelVersion ODE 모델 버전
 * @param supportRunCount 계산에 사용한 support 러닝 수(0 이상)
 * @param summaryUJson ODE 요약 묶음 u JSON
 * @param history8Json History8 개인 맥락 벡터 JSON
 * @param p4Json 4차원 개인 적합 벡터 JSON
 * @param hr0SubBpm support 시작 HR 중앙값(35~220)
 * @param hrRefBpm 기준 심박, 없으면 null
 * @param hrDangerBpm 위험 심박 P98 원값, 없으면 null
 * @param hrSustainBpm 지속 심박 P85, 없으면 null
 * @param hrThresholdRunCount P98·P85 계산에 쓴 러닝 수(0~20), 없으면 null
 */
public record HrPersonalizationCommand(
        String schemaVersion,
        String modelVersion,
        int supportRunCount,
        String summaryUJson,
        String history8Json,
        String p4Json,
        BigDecimal hr0SubBpm,
        BigDecimal hrRefBpm,
        BigDecimal hrDangerBpm,
        BigDecimal hrSustainBpm,
        Integer hrThresholdRunCount) {

    /** 건강 개인화 값이 로그에 남지 않도록 내용을 숨긴다. */
    @Override
    public String toString() {
        return "HrPersonalizationCommand[REDACTED]";
    }
}
