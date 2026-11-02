package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.SessionGoal;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;

/**
 * 단순 규칙 초기 계획(sessions.md "목표 검증·초기 계획·동의"). AI 기반 계획이 도입되면 교체한다.
 *
 * 추천 페이스는 목표 페이스 → 목표 시간÷목표 거리 → 목표 시간÷코스 거리 순서로 정하고 소수 둘째 자리로 반올림한다. 근거가 없으면 계획을
 * 만들지 않는다. 끝 거리(목표 거리, 없으면 코스 거리)가 양수이면 0m부터 1km 단위 구간으로 나누고 마지막 구간은 남은 거리만큼 짧게 둔다(5000.01m이면
 * 마지막 구간이 0.01m여도 합치지 않는다. AI 비율 개수도 같은 올림 구간 수를 따른다). 끝 거리가 없거나 0이면 구간 없이 페이스만 저장한다.
 *
 * 구간 페이스는 {@link SegmentDifficultyProvider}의 난이도 비율로 나눈다. 비율이 없으면(AI 연동 전) 모든 구간이 추천 페이스와 같다.
 */
@Slf4j
final class InitialPacePlanCalculator {

    /** pace_plans.recommended_pace NUMERIC(10,2)의 최댓값. */
    static final BigDecimal MAX_PACE = new BigDecimal("99999999.99");

    /** 구간 길이(m). AI 난이도 비율도 같은 1km 단위로 받는다. */
    static final BigDecimal SEGMENT_LENGTH_M = BigDecimal.valueOf(1000);

    /**
     * 1km 구간 수 상한. 목표 거리는 45km 이하로 검증하므로 목표 거리로는 넘지 않는다. 목표 거리 없이 45km를 넘는 코스를 고른 경우에만 해당하며
     * 구간 행이 과도하게 생기지 않도록 전체를 구간 1개로 저장한다.
     */
    static final int MAX_SEGMENTS = 45;

    private static final BigDecimal METERS_PER_KM = BigDecimal.valueOf(1000);

    private InitialPacePlanCalculator() {}

    /**
     * @param courseDistanceM 선택 코스의 거리(m). 코스가 없으면 null
     * @param difficulty 구간별 난이도 비율. 끝 거리가 있고 구간이 2개 이상일 때만 조회한다
     * @return 계획 근거가 없으면 빈 값. 계산한 페이스가 0이 되거나 저장 범위를 넘으면 422 INVALID_GOAL
     */
    static Optional<PlanDraft> calculate(
            SessionGoal goal, BigDecimal courseDistanceM, SegmentDifficultyProvider difficulty) {
        BigDecimal pace = recommendedPace(goal, courseDistanceM);
        if (pace == null) {
            return Optional.empty();
        }
        if (pace.signum() <= 0 || pace.compareTo(MAX_PACE) > 0) {
            throw SessionErrors.invalidGoal();
        }
        BigDecimal endDistance =
                goal.distanceM() != null ? BigDecimal.valueOf(goal.distanceM()) : courseDistanceM;
        if (endDistance == null || endDistance.signum() <= 0) {
            return Optional.of(new PlanDraft(pace, List.of()));
        }
        // 저장 컬럼 NUMERIC(12,2)에 맞춘다. 현재 입력(정수 목표 거리·NUMERIC(12,2) 코스 거리)은 값이 바뀌지 않는다.
        endDistance = endDistance.setScale(2, RoundingMode.HALF_UP);
        return Optional.of(
                new PlanDraft(pace, segments(goal.courseId(), pace, endDistance, difficulty)));
    }

    private static List<SegmentDraft> segments(
            Long courseId,
            BigDecimal pace,
            BigDecimal endDistance,
            SegmentDifficultyProvider difficulty) {
        int count = endDistance.divide(SEGMENT_LENGTH_M, 0, RoundingMode.CEILING).intValueExact();
        if (count > MAX_SEGMENTS) {
            return List.of(new SegmentDraft(BigDecimal.ZERO, endDistance, pace));
        }
        List<BigDecimal[]> ranges = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            BigDecimal start = SEGMENT_LENGTH_M.multiply(BigDecimal.valueOf(i));
            ranges.add(new BigDecimal[] {start, endDistance.min(start.add(SEGMENT_LENGTH_M))});
        }
        List<BigDecimal> paces =
                count > 1
                        ? difficulty
                                .ratios(courseId, endDistance, count)
                                .map(ratios -> weightedPaces(pace, endDistance, ranges, ratios))
                                .orElse(null)
                        : null;
        List<SegmentDraft> result = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            BigDecimal[] range = ranges.get(i);
            result.add(new SegmentDraft(range[0], range[1], paces == null ? pace : paces.get(i)));
        }
        return List.copyOf(result);
    }

    /**
     * 구간 페이스 = 추천 페이스 × 구간 비율 ÷ 거리 가중 평균 비율. 평균 비율 구간은 추천 페이스, 힘든 구간은 느리게, 쉬운 구간은 빠르게 배분하며
     * 구간별 소요 시간의 합은 추천 페이스로 끝 거리를 달린 시간과 같다(구간별 소수 둘째 자리 반올림 오차만 남는다).
     *
     * <p>AI 결과가 계약과 다르거나 극단적이어서 저장할 수 없는 페이스가 나오면 사용자 요청을 실패시키지 않고 균등 분배(null 반환)로 대신한다.
     */
    private static List<BigDecimal> weightedPaces(
            BigDecimal pace, BigDecimal endDistance, List<BigDecimal[]> ranges, List<BigDecimal> ratios) {
        if (ratios == null
                || ratios.size() != ranges.size()
                || ratios.stream().anyMatch(r -> r == null || r.signum() <= 0)) {
            log.warn("구간 난이도 비율이 구간 수와 맞지 않거나 양수가 아니어서 균등 분배함. segments={}", ranges.size());
            return null;
        }
        BigDecimal weighted = BigDecimal.ZERO;
        for (int i = 0; i < ranges.size(); i++) {
            BigDecimal length = ranges.get(i)[1].subtract(ranges.get(i)[0]);
            weighted = weighted.add(ratios.get(i).multiply(length));
        }
        BigDecimal meanRatio = weighted.divide(endDistance, MathContext.DECIMAL64);
        List<BigDecimal> paces = new ArrayList<>(ranges.size());
        for (BigDecimal ratio : ratios) {
            BigDecimal segmentPace =
                    pace.multiply(ratio)
                            .divide(meanRatio, MathContext.DECIMAL64)
                            .setScale(2, RoundingMode.HALF_UP);
            if (segmentPace.signum() <= 0 || segmentPace.compareTo(MAX_PACE) > 0) {
                log.warn("구간 페이스가 저장 범위를 벗어나 균등 분배함. segments={}", ranges.size());
                return null;
            }
            paces.add(segmentPace);
        }
        return paces;
    }

    private static BigDecimal recommendedPace(SessionGoal goal, BigDecimal courseDistanceM) {
        if (goal.paceSecPerKm() != null) {
            return goal.paceSecPerKm().setScale(2, RoundingMode.HALF_UP);
        }
        if (goal.durationSec() == null) {
            return null;
        }
        BigDecimal distance =
                goal.distanceM() != null ? BigDecimal.valueOf(goal.distanceM()) : courseDistanceM;
        if (distance == null || distance.signum() <= 0) {
            return null;
        }
        return BigDecimal.valueOf(goal.durationSec())
                .multiply(METERS_PER_KM)
                .divide(distance, 2, RoundingMode.HALF_UP);
    }

    /** @param segments 0m부터 이어지는 구간. 끝 거리가 없으면 빈 목록이며 페이스만 저장한다 */
    record PlanDraft(BigDecimal paceSecPerKm, List<SegmentDraft> segments) {}

    /** 거리는 저장 컬럼(NUMERIC(12,2))과 같은 소수 둘째 자리로 맞춰 생성 응답과 이후 조회 응답의 표기를 같게 한다. */
    record SegmentDraft(BigDecimal startDistanceM, BigDecimal endDistanceM, BigDecimal paceSecPerKm) {

        SegmentDraft {
            startDistanceM = startDistanceM.setScale(2, RoundingMode.UNNECESSARY);
            endDistanceM = endDistanceM.setScale(2, RoundingMode.UNNECESSARY);
        }
    }
}
