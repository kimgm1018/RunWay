package com.runway.backend.domain.course.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;

class PythonGradeComparisonTest {
    @Test
    void matchesActualPythonOutputWithinOneTenThousandthPercentagePoint() throws Exception {
        var mapper = JsonMapper.builder().build();
        try (var input = getClass().getResourceAsStream("/course-grade/python-grade.json")) {
            var fixture = mapper.readTree(input);
            assertThat(fixture.path("cases").size()).isEqualTo(24);
            for (JsonNode sample : fixture.path("cases")) {
                var distance = new BigDecimal(sample.path("distanceM").asText());
                var actual =
                        GradeProfileCalculator.calculate(
                                distance,
                                doubles(sample.path("distancesM")),
                                doubles(sample.path("elevationsM")));
                var expected = sample.path("expected");
                assertThat(actual).as(sample.path("name").asText()).hasSize(expected.size());
                for (int i = 0; i < actual.size(); i++) {
                    var row = expected.get(i);
                    assertThat(actual.get(i).startDistanceM())
                            .isEqualByComparingTo(row.path("startDistanceM").asText());
                    assertThat(actual.get(i).endDistanceM())
                            .isEqualByComparingTo(row.path("endDistanceM").asText());
                    assertThat(actual.get(i).gradePercent().doubleValue())
                            .as("%s segment %s", sample.path("name").asText(), i)
                            .isCloseTo(row.path("gradePercent").asDouble(), within(0.0001));
                }
                assertThat(GradeProfileValidator.validate(actual, distance)).isEqualTo(actual);
            }
        }
    }

    private static double[] doubles(JsonNode values) {
        double[] result = new double[values.size()];
        for (int i = 0; i < result.length; i++) result[i] = values.get(i).asDouble();
        return result;
    }
}
