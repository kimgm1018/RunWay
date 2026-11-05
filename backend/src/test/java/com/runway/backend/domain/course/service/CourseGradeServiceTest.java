package com.runway.backend.domain.course.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonLineString;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

class CourseGradeServiceTest {
    private static final GeoJsonLineString ROUTE =
            GeoJsonLineString.of(List.of(List.of(10.0, 40.0), List.of(10.01, 40.0)));

    @Test
    void samplesBetweenSparseVerticesSoTheMiddleOfTheRouteIsNotAssumedFlat() {
        ElevationSource hill = (lon, lat) -> 10 + 20 * Math.sin((lon - 10) / .01 * Math.PI);
        var result = new CourseGradeService(hill).calculate(ROUTE, new BigDecimal("1000"));
        assertThat(result).hasSize(10);
        assertThat(result.get(1).gradePercent()).isPositive();
        assertThat(result.get(8).gradePercent()).isNegative();
        assertThat(GradeProfileValidator.validate(result, new BigDecimal("1000")))
                .isEqualTo(result);
    }

    @Test
    void interpolatesMarkedBridgeInteriorUsingOnlyItsEndpointElevations() {
        // DEM terrain beneath a bridge is unreliable. Its measured endpoints are both 10m.
        ElevationSource terrain = (lon, lat) -> lon > 10.002 && lon < 10.008 ? 100 : 10;
        var service = new CourseGradeService(terrain);
        var result =
                service.calculate(
                        ROUTE,
                        new BigDecimal("1000"),
                        List.of(new CourseGradeService.UnmeasuredSection(200, 800)));
        assertThat(result).allSatisfy(s -> assertThat(s.gradePercent()).isZero());
    }

    @Test
    void interpolatesPartialDemCoverageButRejectsCompletelyUnknownRoutes() {
        var service = new CourseGradeService((lon, lat) -> lon < 10.004 ? Double.NaN : 10);
        assertThat(service.calculate(ROUTE, new BigDecimal("1000")))
                .allSatisfy(s -> assertThat(s.gradePercent()).isZero());
        assertThatThrownBy(
                        () ->
                                new CourseGradeService((lon, lat) -> Double.NaN)
                                        .calculate(ROUTE, new BigDecimal("1000")))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void repeatedCoordinatesDoNotIntroduceZeroLengthInterpolationDivisors() {
        var repeated =
                GeoJsonLineString.of(
                        List.of(
                                List.of(10.0, 40.0),
                                List.of(10.0, 40.0),
                                List.of(10.01, 40.0),
                                List.of(10.01, 40.0)));
        var service = new CourseGradeService((lon, lat) -> (lon - 10) * 1000);
        assertThat(service.calculate(repeated, new BigDecimal("1000")))
                .isEqualTo(service.calculate(ROUTE, new BigDecimal("1000")));
    }

    @Test
    void samplesShortUnmeasuredSectionEndpointsEvenWhenTheyAreNotOnTwentyMetreGrid() {
        List<Double> queriedLongitudes = new ArrayList<>();
        var service =
                new CourseGradeService(
                        (lon, lat) -> {
                            queriedLongitudes.add(lon);
                            return 10;
                        });
        assertThat(
                        service.calculate(
                                ROUTE,
                                new BigDecimal("1000"),
                                List.of(new CourseGradeService.UnmeasuredSection(201, 219))))
                .allSatisfy(s -> assertThat(s.gradePercent()).isZero());
        assertThat(queriedLongitudes)
                .anySatisfy(lon -> assertThat(lon).isCloseTo(10.00201, within(1e-10)));
        assertThat(queriedLongitudes)
                .anySatisfy(lon -> assertThat(lon).isCloseTo(10.00219, within(1e-10)));
    }

    @Test
    void rejectsDegenerateRouteAndInvalidUnmeasuredIntervals() {
        var service = new CourseGradeService((lon, lat) -> 10);
        var degenerate = GeoJsonLineString.of(List.of(List.of(10.0, 40.0), List.of(10.0, 40.0)));
        assertThatThrownBy(() -> service.calculate(degenerate, new BigDecimal("1000")))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.calculate(null, new BigDecimal("1000")))
                .isInstanceOf(ApiException.class);
        for (var section :
                List.of(
                        new CourseGradeService.UnmeasuredSection(-1, 20),
                        new CourseGradeService.UnmeasuredSection(20, 10),
                        new CourseGradeService.UnmeasuredSection(0, 1001),
                        new CourseGradeService.UnmeasuredSection(Double.NaN, 20))) {
            assertThatThrownBy(
                            () ->
                                    service.calculate(
                                            ROUTE, new BigDecimal("1000"), List.of(section)))
                    .isInstanceOf(ApiException.class);
        }
    }

    @Test
    void followsShortestLongitudeAcrossAntimeridian() {
        var route = GeoJsonLineString.of(List.of(List.of(179.99, 0.0), List.of(-179.99, 0.0)));
        // Reject wrong lookup coordinates immediately; NaN would hide them through gap
        // interpolation.
        var service =
                new CourseGradeService(
                        (lon, lat) -> {
                            assertThat(Math.abs(lon)).isGreaterThan(179.9);
                            return 10;
                        });
        assertThat(service.calculate(route, new BigDecimal("2224")))
                .allSatisfy(s -> assertThat(s.gradePercent()).isZero());
    }

    @Test
    void rejectsUnboundedDemWorkBeforeAllocatingOrQuerying() {
        var service =
                new CourseGradeService(
                        (lon, lat) -> {
                            throw new AssertionError("must not query");
                        });
        assertThatThrownBy(() -> service.calculate(ROUTE, new BigDecimal("9999999999.99")))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void mergesAdjacentBridgeAndTunnelSectionsBeforeSamplingTheirSharedInterior() {
        var service =
                new CourseGradeService((lon, lat) -> Math.abs(lon - 10.005) < 0.0005 ? 100 : 10);
        var result =
                service.calculate(
                        ROUTE,
                        new BigDecimal("1000"),
                        List.of(
                                new CourseGradeService.UnmeasuredSection(200, 500),
                                new CourseGradeService.UnmeasuredSection(500, 800)));
        assertThat(result).allSatisfy(s -> assertThat(s.gradePercent()).isZero());
    }

    @Test
    void negativeZeroIntervalBoundaryIsTheSameAsPositiveZero() {
        var service = new CourseGradeService((lon, lat) -> 10);
        var expected =
                service.calculate(
                        ROUTE,
                        new BigDecimal("1000"),
                        List.of(new CourseGradeService.UnmeasuredSection(0.0, 100)));
        assertThat(
                        service.calculate(
                                ROUTE,
                                new BigDecimal("1000"),
                                List.of(new CourseGradeService.UnmeasuredSection(-0.0, 100))))
                .isEqualTo(expected);
        assertThat(service.calculate(ROUTE, new BigDecimal("1000"))).isEqualTo(expected);
    }
}
