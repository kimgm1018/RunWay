package com.runway.backend.domain.session.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.service.InitialPacePlanCalculator.PlanDraft;
import com.runway.backend.global.exception.ApiException;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** AC-3 산식 경계와 1km 구간·난이도 비율 배분. */
class InitialPacePlanCalculatorTest {

    private static final SegmentDifficultyProvider UNIFORM = (course, distance, count) -> Optional.empty();

    private static SessionGoal goal(Long course, Integer distance, Integer duration, String pace) {
        return new SessionGoal(
                course, null, distance, duration, pace == null ? null : new BigDecimal(pace));
    }

    private static SegmentDifficultyProvider ratios(String... values) {
        List<BigDecimal> list = Arrays.stream(values).map(BigDecimal::new).toList();
        return (course, distance, count) -> Optional.of(list);
    }

    private static PlanDraft plan(SessionGoal goal, String courseDistance, SegmentDifficultyProvider difficulty) {
        return InitialPacePlanCalculator.calculate(
                        goal, courseDistance == null ? null : new BigDecimal(courseDistance), difficulty)
                .orElseThrow();
    }

    private static List<String> paces(PlanDraft draft) {
        return draft.segments().stream().map(s -> s.paceSecPerKm().toPlainString()).toList();
    }

    private static List<String> ranges(PlanDraft draft) {
        return draft.segments().stream()
                .map(s -> s.startDistanceM().toPlainString() + "~" + s.endDistanceM().toPlainString())
                .toList();
    }

    /** 구간별 소요 시간(초) 합계. 페이스(초/km) × 길이(km). */
    private static BigDecimal totalSeconds(PlanDraft draft) {
        return draft.segments().stream()
                .map(s -> s.paceSecPerKm().multiply(s.endDistanceM().subtract(s.startDistanceM())))
                .reduce(BigDecimal.ZERO, BigDecimal::add)
                .divide(BigDecimal.valueOf(1000));
    }

    @Test
    void 목표_페이스가_가장_우선이고_끝거리는_목표거리다() {
        var draft = plan(goal(1L, 3000, null, "310.5"), "5000", UNIFORM);
        assertThat(draft.paceSecPerKm()).isEqualByComparingTo("310.50");
        assertThat(draft.paceSecPerKm().scale()).isEqualTo(2);
        assertThat(draft.segments()).hasSize(3);
        assertThat(draft.segments().getLast().endDistanceM()).isEqualByComparingTo("3000");
    }

    @Test
    void 시간과_거리로_나누고_둘째_자리로_반올림한다() {
        assertThat(plan(goal(null, 3000, 1000, null), null, UNIFORM).paceSecPerKm())
                .isEqualByComparingTo("333.33");
        assertThat(plan(goal(null, 8000, 1, null), null, UNIFORM).paceSecPerKm())
                .isEqualByComparingTo("0.13");
    }

    @Test
    void 거리가_없으면_코스거리를_쓴다() {
        var draft = plan(goal(1L, null, 1500, null), "5000.00", UNIFORM);
        assertThat(draft.paceSecPerKm()).isEqualByComparingTo("300");
        assertThat(draft.segments().getLast().endDistanceM()).isEqualByComparingTo("5000");
    }

    @Test
    void 근거가_없으면_계획이_없다() {
        assertThat(InitialPacePlanCalculator.calculate(goal(null, null, null, null), null, UNIFORM))
                .isEmpty();
        assertThat(InitialPacePlanCalculator.calculate(goal(null, 5000, null, null), null, UNIFORM))
                .isEmpty();
        assertThat(InitialPacePlanCalculator.calculate(goal(null, null, 1500, null), null, UNIFORM))
                .isEmpty();
        assertThat(
                        InitialPacePlanCalculator.calculate(
                                goal(1L, null, null, null), new BigDecimal("5000"), UNIFORM))
                .isEmpty();
    }

    @Test
    void 페이스만_있거나_끝거리가_0이면_구간이_없다() {
        assertThat(plan(goal(null, null, null, "300"), null, UNIFORM).segments()).isEmpty();
        assertThat(plan(goal(1L, null, null, "300"), "0", UNIFORM).segments()).isEmpty();
    }

    @Test
    void 계산값이_0이거나_저장범위를_넘으면_INVALID_GOAL() {
        assertThatThrownBy(
                        () ->
                                InitialPacePlanCalculator.calculate(
                                        goal(null, 2_000_000_000, 1, null), null, UNIFORM))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).code())
                .isEqualTo("INVALID_GOAL");
        assertThatThrownBy(
                        () ->
                                InitialPacePlanCalculator.calculate(
                                        goal(null, 1, Integer.MAX_VALUE, null), null, UNIFORM))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).code())
                .isEqualTo("INVALID_GOAL");
    }

    @Test
    void 비율이_없으면_1km_구간마다_같은_평균_페이스다() {
        var draft = plan(goal(null, 2500, null, "300"), null, UNIFORM);
        assertThat(ranges(draft))
                .containsExactly("0.00~1000.00", "1000.00~2000.00", "2000.00~2500.00");
        assertThat(paces(draft)).containsOnly("300.00");
    }

    @Test
    void 소수_코스거리는_마지막_구간에_남는다() {
        var draft = plan(goal(1L, null, null, "300"), "4200.50", UNIFORM);
        assertThat(draft.segments()).hasSize(5);
        assertThat(ranges(draft).getLast()).isEqualTo("4000.00~4200.50");
        var tail = plan(goal(1L, null, null, "300"), "5000.01", UNIFORM);
        assertThat(ranges(tail).getLast()).isEqualTo("5000.00~5000.01");
    }

    @Test
    void 비율대로_페이스를_나누고_전체_시간은_유지한다() {
        // 3km·300초/km = 900초. 가중 평균 비율 1.0 → 구간 페이스 = 300 × 비율
        var draft = plan(goal(1L, 3000, null, "300"), null, ratios("1.2", "0.8", "1.0"));
        assertThat(paces(draft)).containsExactly("360.00", "240.00", "300.00");
        assertThat(totalSeconds(draft)).isEqualByComparingTo("900");
    }

    @Test
    void 비율은_상대값이라_배수를_바꿔도_같은_계획이다() {
        var small = plan(goal(1L, 3000, null, "300"), null, ratios("1.2", "0.8", "1.0"));
        var large = plan(goal(1L, 3000, null, "300"), null, ratios("12", "8", "10"));
        assertThat(paces(large)).isEqualTo(paces(small));
    }

    @Test
    void 짧은_마지막_구간은_거리만큼만_평균에_반영한다() {
        // 1.5km·300초/km = 450초. 가중 평균 = (2×1000 + 1×500) / 1500 = 5/3
        var draft = plan(goal(1L, 1500, null, "300"), null, ratios("2", "1"));
        assertThat(paces(draft)).containsExactly("360.00", "180.00");
        assertThat(totalSeconds(draft)).isEqualByComparingTo("450");
    }

    @Test
    void 비율이_계약과_다르면_균등_분배로_대신한다() {
        var goal = goal(1L, 3000, null, "300");
        assertThat(paces(plan(goal, null, ratios("1", "2")))).containsOnly("300.00");
        assertThat(paces(plan(goal, null, ratios("1", "0", "1")))).containsOnly("300.00");
        assertThat(paces(plan(goal, null, ratios("1", "-1", "1")))).containsOnly("300.00");
        SegmentDifficultyProvider withNull =
                (course, distance, count) -> Optional.of(Arrays.asList(BigDecimal.ONE, null, BigDecimal.ONE));
        assertThat(paces(plan(goal, null, withNull))).containsOnly("300.00");
    }

    @Test
    void 비율로_계산한_페이스가_저장범위를_벗어나면_균등_분배로_대신한다() {
        // 추천 페이스 0.13에서 쉬운 구간이 0으로 반올림된다
        var draft =
                plan(goal(null, 8000, 1, null), null, ratios("1000", "1", "1", "1", "1", "1", "1", "1"));
        assertThat(paces(draft)).containsOnly("0.13");
    }

    @Test
    void 구간이_하나뿐이면_비율을_조회하지_않는다() {
        AtomicInteger calls = new AtomicInteger();
        SegmentDifficultyProvider counting =
                (course, distance, count) -> {
                    calls.incrementAndGet();
                    return Optional.empty();
                };
        assertThat(plan(goal(1L, 800, null, "300"), null, counting).segments()).hasSize(1);
        assertThat(plan(goal(1L, 1000, null, "300"), null, counting).segments()).hasSize(1);
        assertThat(calls).hasValue(0);
        plan(goal(1L, 1001, null, "300"), null, counting);
        assertThat(calls).hasValue(1);
    }

    @Test
    void 비율_조회에_코스_끝거리_구간수를_넘긴다() {
        Object[] seen = new Object[3];
        SegmentDifficultyProvider capture =
                (course, distance, count) -> {
                    seen[0] = course;
                    seen[1] = distance;
                    seen[2] = count;
                    return Optional.empty();
                };
        plan(goal(7L, null, 1500, null), "4200.00", capture);
        assertThat(seen[0]).isEqualTo(7L);
        assertThat((BigDecimal) seen[1]).isEqualByComparingTo("4200");
        assertThat(seen[2]).isEqualTo(5);
    }

    @Test
    void 코스거리로_구간_수가_상한을_넘으면_전체를_구간_하나로_저장한다() {
        var atLimit = plan(goal(1L, null, null, "300"), "45000.00", UNIFORM);
        assertThat(atLimit.segments()).hasSize(InitialPacePlanCalculator.MAX_SEGMENTS);
        AtomicInteger calls = new AtomicInteger();
        SegmentDifficultyProvider counting =
                (course, distance, count) -> {
                    calls.incrementAndGet();
                    return Optional.empty();
                };
        var over = plan(goal(1L, null, null, "300"), "45000.01", counting);
        assertThat(calls).hasValue(0);
        assertThat(over.segments()).hasSize(1);
        assertThat(over.segments().getFirst().endDistanceM()).isEqualByComparingTo("45000.01");
        assertThat(over.segments().getFirst().paceSecPerKm()).isEqualByComparingTo("300");
    }
}
