package com.runway.backend.domain.grouprun.helper;

import java.util.List;

/**
 * G14 그룹 단위 파생 집계. 저장하지 않고 조회 시점에 참가자 측정값에서 계산한다.
 *
 * <p>집계 대상(eligible)은 실제 시작이 확인되었고(startedAt 있음) 실제 거리가 null이 아닌 참가자다. 호출자는 대상 참가자의 값만 넘긴다.
 */
public final class GroupResultAggregates {

    private GroupResultAggregates() {}

    /**
     * @param distanceM 함께 달린 거리 = 대상 참가자 거리의 최솟값(m)
     * @param averagePaceSecPerKm 대상 참가자의 null 아닌 평균 페이스 산술평균을 정수 sec/km로 반올림
     * @param maxGapM 대상 참가자 거리의 max - min(m). 대상이 1명이면 0
     */
    public record Result(Double distanceM, Integer averagePaceSecPerKm, Double maxGapM) {

        public static final Result EMPTY = new Result(null, null, null);
    }

    /**
     * @param groupReady 그룹 analysis.status가 READY인지 여부. 아니면 모두 null.
     * @param eligibleDistancesM 대상 참가자의 실제 거리(m). 대상이 없으면 모두 null.
     * @param eligiblePaces 대상 참가자의 평균 페이스(sec/km). null 값은 평균에서 제외한다.
     */
    public static Result of(
            boolean groupReady, List<Double> eligibleDistancesM, List<Double> eligiblePaces) {
        if (!groupReady || eligibleDistancesM == null || eligibleDistancesM.isEmpty()) {
            return Result.EMPTY;
        }
        double min = Double.POSITIVE_INFINITY;
        double max = Double.NEGATIVE_INFINITY;
        for (Double d : eligibleDistancesM) {
            min = Math.min(min, d);
            max = Math.max(max, d);
        }
        double paceSum = 0d;
        int paceCount = 0;
        if (eligiblePaces != null) {
            for (Double p : eligiblePaces) {
                if (p != null) {
                    paceSum += p;
                    paceCount++;
                }
            }
        }
        Integer pace = paceCount == 0 ? null : (int) Math.round(paceSum / paceCount);
        return new Result(min, pace, max - min);
    }
}
