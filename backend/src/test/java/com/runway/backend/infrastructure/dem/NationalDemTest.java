package com.runway.backend.infrastructure.dem;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.course.service.CourseGradeService;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Uses a separately supplied national DEM and trusted manifest hash, never the Busan hash. */
@EnabledIfEnvironmentVariable(named = "NATIONAL_DEM_PATH", matches = ".+")
@EnabledIfEnvironmentVariable(named = "NATIONAL_DEM_SHA256", matches = "[a-fA-F0-9]{64}")
class NationalDemTest {
    @Test
    void samplesFiveRegionsAndGrades() {
        try (var source = GeoTiffElevationSource.load(Path.of(System.getenv("NATIONAL_DEM_PATH")),
                System.getenv("NATIONAL_DEM_SHA256"))) {
            for (double[] point : new double[][] {{126.9780, 37.5665}, {129.0786, 35.1586},
                    {127.3504, 36.3675}, {128.3446, 36.1195}, {126.8115, 35.2055}}) {
                assertThat(source.elevationAt(point[0], point[1])).isFinite();
                var route = GeoJsonLineString.of(List.of(List.of(point[0], point[1]),
                        List.of(point[0] + .001, point[1] + .001)));
                var grades = new CourseGradeService(source).calculate(route, new BigDecimal("200"));
                assertThat(grades).isNotEmpty();
                assertThat(grades.getFirst().startDistanceM()).isEqualByComparingTo("0");
                assertThat(grades.getLast().endDistanceM()).isEqualByComparingTo("200");
                for (int i = 0; i < grades.size(); i++) {
                    assertThat(grades.get(i).gradePercent()).isNotNull();
                    if (i > 0) assertThat(grades.get(i).startDistanceM())
                            .isEqualByComparingTo(grades.get(i - 1).endDistanceM());
                }
            }
        }
    }
}
