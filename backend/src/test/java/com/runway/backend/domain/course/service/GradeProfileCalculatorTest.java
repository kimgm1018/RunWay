package com.runway.backend.domain.course.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.math.BigDecimal;
import java.time.Duration;

class GradeProfileCalculatorTest {
    @Test
    void interpolatesMissingAndOutOfRangeElevationsBeforeSmoothing() {
        var expected =
                GradeProfileCalculator.calculate(
                        new BigDecimal("400"), new double[] {0, 400}, new double[] {10, 30});
        var actual =
                GradeProfileCalculator.calculate(
                        new BigDecimal("400"),
                        new double[] {0, 100, 200, 300, 400},
                        new double[] {10, Double.NaN, 10000, Double.POSITIVE_INFINITY, 30});
        assertThat(actual).isEqualTo(expected);
    }

    @Test
    void extendsNearestKnownElevationAtBothEnds() {
        var actual =
                GradeProfileCalculator.calculate(
                        new BigDecimal("400"),
                        new double[] {0, 100, 300, 400},
                        new double[] {Double.NaN, 20, 20, Double.NaN});
        assertThat(actual).allSatisfy(s -> assertThat(s.gradePercent()).isZero());
    }

    @ParameterizedTest
    @ValueSource(doubles = {1, -1})
    void repairsExtremeShortTailWithNeighbourGradeInsteadOfClamping(double sign) {
        var result =
                GradeProfileCalculator.calculate(
                        new BigDecimal("100.01"),
                        new double[] {0, 100.01},
                        new double[] {0, sign * 20});
        assertThat(result).hasSize(2);
        assertThat(result.get(1).gradePercent()).isEqualByComparingTo(result.get(0).gradePercent());
        assertThat(result.get(1).gradePercent().abs()).isLessThan(new BigDecimal("100"));
        assertThat(GradeProfileValidator.validate(result, new BigDecimal("100.01"))).hasSize(2);
    }

    @Test
    void roundsStoredDistanceBeforeSelectingGrid() {
        var result =
                GradeProfileCalculator.calculate(
                        new BigDecimal("45000.004"),
                        new double[] {0, 45000.004},
                        new double[] {10, 10});
        assertThat(result).hasSize(450);
        assertThat(result.getLast().endDistanceM()).isEqualByComparingTo("45000");
        assertThat(result.getFirst().endDistanceM()).isEqualByComparingTo("100");
    }

    @Test
    void rejectsInsufficientElevationWithoutInventingFlatGround() {
        for (double[] elevations : new double[][] {{Double.NaN, Double.NaN}, {10, Double.NaN}}) {
            assertThatThrownBy(
                            () ->
                                    GradeProfileCalculator.calculate(
                                            new BigDecimal("100"),
                                            new double[] {0, 100},
                                            elevations))
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            e ->
                                    assertThat(e.errorCode())
                                            .isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
        }
    }

    @Test
    void rejectsProfilesWithNoPlausibleGrade() {
        assertThatThrownBy(
                        () ->
                                GradeProfileCalculator.calculate(
                                        new BigDecimal("1"),
                                        new double[] {0, 1},
                                        new double[] {0, 100}))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
    }

    @Test
    void rejectsMalformedInputsBeforeAllocation() {
        assertTimeoutPreemptively(
                Duration.ofSeconds(2),
                () -> {
                    for (String distance : new String[] {"0", "-1", "0.004", "1E1000000"}) {
                        assertThatThrownBy(
                                        () ->
                                                GradeProfileCalculator.calculate(
                                                        new BigDecimal(distance),
                                                        new double[] {0, 100},
                                                        new double[] {10, 10}))
                                .isInstanceOf(ApiException.class);
                    }
                });
        for (double[] xs : new double[][] {{0, 0}, {10, 0}, {0, Double.NaN}, {0, 101}}) {
            assertThatThrownBy(
                            () ->
                                    GradeProfileCalculator.calculate(
                                            new BigDecimal("100"), xs, new double[] {1, 2}))
                    .isInstanceOf(ApiException.class);
        }
        assertThatThrownBy(
                        () -> GradeProfileCalculator.calculate(new BigDecimal("100"), null, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(
                        () ->
                                GradeProfileCalculator.calculate(
                                        new BigDecimal("100"),
                                        new double[] {0, 100},
                                        new double[] {10}))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void calculatesSchemaMaximumDistanceWithoutAllocatingTheEntireTwentyMetreGrid() {
        assertTimeoutPreemptively(
                Duration.ofSeconds(2),
                () -> {
                    var result =
                            GradeProfileCalculator.calculate(
                                    new BigDecimal("9999999999.99"),
                                    new double[] {0, 9999999999.99},
                                    new double[] {10, 10});
                    assertThat(result).hasSizeLessThanOrEqualTo(450);
                    assertThat(result.getLast().endDistanceM())
                            .isEqualByComparingTo("9999999999.99");
                });
    }

    @Test
    void repairsAnInteriorExtremeGradeUsingItsTwoValidNeighbours() {
        var result =
                GradeProfileCalculator.calculate(
                        new BigDecimal("500"),
                        new double[] {0, 100, 200, 300, 400, 500},
                        new double[] {0, 10, 210, 220, 200, 190});
        // Independent Python output before repair: [22, 174.6667, 18.6667, -15.3333, -10].
        assertThat(result.get(1).gradePercent()).isEqualByComparingTo("20.3333");
        assertThat(result.get(0).gradePercent()).isEqualByComparingTo("22");
        assertThat(result.get(2).gradePercent()).isEqualByComparingTo("18.6667");
    }

    @Test
    void rejectsExtremelySmallExponentBeforeBigDecimalScaleArithmetic() {
        // The previous implementation throws immediately; never expand 10^100000000 in-process.
        assertTimeoutPreemptively(
                Duration.ofSeconds(1),
                () ->
                        assertThatThrownBy(
                                        () ->
                                                GradeProfileCalculator.calculate(
                                                        new BigDecimal("1E-2147483647"),
                                                        new double[] {0, 100},
                                                        new double[] {10, 10}))
                                .isInstanceOfSatisfying(
                                        ApiException.class,
                                        e ->
                                                assertThat(e.errorCode())
                                                        .isEqualTo(ErrorCode.VALIDATION_ERROR)));
    }

    @Test
    void preservesHalfCentRoundingBoundary() {
        assertThatThrownBy(
                        () ->
                                GradeProfileCalculator.calculate(
                                        new BigDecimal("0.004999"),
                                        new double[] {0, .004999},
                                        new double[] {10, 10}))
                .isInstanceOf(ApiException.class);
        var result =
                GradeProfileCalculator.calculate(
                        new BigDecimal("0.005"), new double[] {0, .005}, new double[] {10, 10});
        assertThat(result).hasSize(1);
        assertThat(result.getFirst().endDistanceM()).isEqualByComparingTo("0.01");
    }
}
