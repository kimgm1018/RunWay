package com.runway.backend.domain.session.entity;

import java.math.BigDecimal;

/**
 * 종료 후 분석(S15P31E105-312)이 계산해 running_sessions에 덮어쓰는 통계. 값이 없으면 0이 아니라 null이다.
 *
 * @param totalDistance 마지막 누적거리(m). 거리 샘플이 없으면 null
 * @param movingDuration 일시정지를 제외한 운동시간(초)
 * @param elapsedDuration 시작~종료 실제 경과시간(초)
 * @param movingDurationToGoal 목표 거리에 처음 도달한 운동시간(초). 목표 거리가 없거나 미도달이면 null
 * @param goalAchieved 목표 달성 여부. 목표가 없거나 평가할 수 없으면 null
 * @param averagePace 평균 페이스(초/km). 거리 0·운동시간 0이면 null
 * @param averageHeartRate 측정된 심박 평균. 미측정이면 null
 * @param averageCadence 측정된 케이던스 평균. 미측정이면 null
 * @param maxHeartRate 측정된 최대 심박. 미측정이면 null
 */
public record SessionAnalysisStats(
        BigDecimal totalDistance,
        Integer movingDuration,
        Integer elapsedDuration,
        Integer movingDurationToGoal,
        Boolean goalAchieved,
        BigDecimal averagePace,
        BigDecimal averageHeartRate,
        BigDecimal averageCadence,
        BigDecimal maxHeartRate) {}
