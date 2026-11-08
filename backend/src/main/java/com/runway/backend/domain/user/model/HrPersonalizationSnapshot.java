package com.runway.backend.domain.user.model;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * 저장된 심박 개인화 최신 행. AI 조회와 같은 컬럼을 담는다. JSON 필드는 {@code jsonb}를 문자열로 읽은 값이다.
 *
 * @param userId 회원 ID
 * @param personalizationVersion 회원별 개인화 버전
 * @param schemaVersion 개인화 JSON 스키마 버전
 * @param modelVersion ODE 모델 버전
 * @param supportRunCount 계산에 사용한 support 러닝 수
 * @param summaryUJson ODE 요약 묶음 u JSON
 * @param history8Json History8 개인 맥락 벡터 JSON
 * @param p4Json 4차원 개인 적합 벡터 JSON
 * @param hr0SubBpm support 시작 HR 중앙값
 * @param hrRefBpm 기준 심박, 없으면 null
 * @param hrDangerBpm 위험 심박 P98 원값(+3 전), 없으면 null
 * @param hrSustainBpm 지속 심박 P85, 없으면 null
 * @param hrThresholdRunCount P98·P85 계산에 쓴 러닝 수, 없으면 null
 * @param createdAt 생성일시
 */
public record HrPersonalizationSnapshot(
        long userId,
        int personalizationVersion,
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
        Integer hrThresholdRunCount,
        OffsetDateTime createdAt) {

    /** 건강 개인화 값이 로그에 남지 않도록 내용을 숨긴다. */
    @Override
    public String toString() {
        return "HrPersonalizationSnapshot[userId="
                + userId
                + ", personalizationVersion="
                + personalizationVersion
                + "]";
    }
}
