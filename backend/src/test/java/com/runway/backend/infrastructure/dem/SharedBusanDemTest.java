package com.runway.backend.infrastructure.dem;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.service.CourseGradeService;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * AI 팀이 공유한 실제 부산 DEM(backend/README.md 9절)으로 로더·경사 계산을 확인한다. 파일은 Git에 넣지 않으므로
 * {@code BACKEND_COURSE_DEM_PATH}가 있을 때만 실행한다. 기본 빌드에서는 합성 DEM 테스트가 같은 코드를 검증한다.
 */
@EnabledIfEnvironmentVariable(named = "BACKEND_COURSE_DEM_PATH", matches = ".+")
class SharedBusanDemTest {

    /** application.yml 기본값과 같은 공유 DEM 해시. */
    private static final String SHARED_SHA256 =
            "45faaa5e36c710a235658e1172183279007ac3b3fdcc29a14246222fdabb3a1f";

    private static GeoTiffElevationSource load() {
        return GeoTiffElevationSource.load(
                Path.of(System.getenv("BACKEND_COURSE_DEM_PATH")), SHARED_SHA256);
    }

    @Test
    void 공유DEM은_해시검증을_통과하고_부산_범위를_덮으며_바다는_0m다() {
        var dem = load();

        // 황령산 정상 부근(약 427m)과 부산 서·동·남·북 가장자리 안쪽.
        assertThat(dem.elevationAt(129.0786, 35.1586)).isBetween(250d, 450d);
        assertThat(dem.elevationAt(128.75, 35.10)).isFinite();
        assertThat(dem.elevationAt(129.33, 35.20)).isFinite();
        assertThat(dem.elevationAt(129.00, 34.87)).isFinite();
        assertThat(dem.elevationAt(129.10, 35.40)).isFinite();
        // nodata 없이 바다는 0m(해운대 앞바다).
        assertThat(dem.elevationAt(129.20, 35.10)).isZero();
        // clip 밖은 측정 없음.
        assertThat(dem.elevationAt(129.40, 35.10)).isNaN();
        assertThat(dem.elevationAt(129.00, 35.45)).isNaN();
    }

    @Test
    void 황령산으로_오르는_경로는_오르막_경사가_나오고_계약형식을_지킨다() {
        // 남천동 쪽 저지대(합성 좌표)에서 황령산 정상 방향으로 곧게 오르는 약 1.6km 경로.
        List<List<Double>> points = new ArrayList<>();
        double startLon = 129.1000;
        double startLat = 35.1450;
        double endLon = 129.0786;
        double endLat = 35.1586;
        for (int i = 0; i <= 40; i++) {
            double t = i / 40d;
            points.add(List.of(startLon + (endLon - startLon) * t, startLat + (endLat - startLat) * t));
        }
        var route = GeoJsonLineString.of(points);
        var grades = new CourseGradeService(load()).calculate(route, new BigDecimal("2500.00"));

        assertThat(grades).isNotEmpty();
        assertThat(grades.getFirst().startDistanceM()).isEqualByComparingTo("0");
        assertThat(grades.getLast().endDistanceM()).isEqualByComparingTo("2500.00");
        double climb = 0;
        for (GradeSegment segment : grades) {
            assertThat(segment.gradePercent()).isNotNull();
            assertThat(segment.gradePercent().abs()).isLessThanOrEqualTo(new BigDecimal("100"));
            climb +=
                    segment.gradePercent().doubleValue()
                            / 100
                            * segment.endDistanceM().subtract(segment.startDistanceM()).doubleValue();
        }
        // 저지대→정상 부근이므로 전체적으로 오르막이다.
        assertThat(climb).isGreaterThan(150);
    }
}
