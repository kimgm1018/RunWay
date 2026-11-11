package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.dto.request.GeneratedCourseSaveCommand;
import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.service.CourseService;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.infrastructure.route.FakeRouteServer;
import com.runway.backend.support.SharedPostgres;
import java.awt.image.BufferedImage;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 생성 코스 저장 커밋 → 커밋 후 이벤트 → Route 바탕 지도 HTTP 호출 → 썸네일 PNG 그리기·볼륨 저장 → 행 저장 — 612. Route 주소가 필요해 공유
 * 컨텍스트를 쓰지 않는다. Route는 루프백 가짜 서버이며 모든 값은 합성 데이터다.
 */
@SpringBootTest
class CourseBasemapAfterCourseSaveIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(CourseBasemapAfterCourseSaveIntegrationTest.class);
    static final FakeRouteServer ROUTE = new FakeRouteServer();
    static final Path VOLUME = createVolume();

    private static Path createVolume() {
        try {
            return Files.createTempDirectory("course-basemap-volume");
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    private static final BigDecimal DISTANCE_M = new BigDecimal("2500.00");
    private static final GeoJsonLineString PATH =
            GeoJsonLineString.of(
                    List.of(List.of(129.0, 35.0), List.of(129.01, 35.01), List.of(129.02, 35.0)));
    private static final String THREE_FEATURES =
            """
            {"osm_data_timestamp":"2026-10-20T00:00:00Z","buildings_available":true,
             "buildings_osm_data_timestamp":"2026-10-21T00:00:00Z","features":[
              {"kind":"road","road_class":"residential","geometry":{"type":"LineString","coordinates":[[129.0,35.0],[129.02,35.01]]}},
              {"kind":"river","geometry":{"type":"LineString","coordinates":[[129.0,35.01],[129.02,35.0]]}},
              {"kind":"park","geometry":{"type":"Polygon","coordinates":
                [[[129.0,35.0],[129.01,35.0],[129.01,35.01],[129.0,35.0]]]}},
              {"kind":"building","height_m":21.0,"geometry":{"type":"Polygon","coordinates":
                [[[129.012,35.004],[129.013,35.004],[129.013,35.005],[129.012,35.004]]]}}]}
            """;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.course.route.mode", () -> "http");
        registry.add("runway.course.route.base-url", () -> ROUTE.baseUri().toString());
        registry.add("runway.images.volume-path", () -> VOLUME.toString());
    }

    @AfterAll
    static void stopRoute() throws java.io.IOException {
        ROUTE.close();
        org.springframework.util.FileSystemUtils.deleteRecursively(VOLUME);
    }

    @Autowired private CourseService courseService;
    @Autowired private CourseBasemapDispatcher dispatcher;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper jsonMapper;
    @Autowired private TransactionTemplate transactionTemplate;

    @BeforeEach
    void reset() throws InterruptedException {
        awaitIdle();
        jdbc.update("DELETE FROM courses");
        ROUTE.reset();
    }

    private static List<GradeSegment> profile() {
        BigDecimal step = BigDecimal.valueOf(100);
        List<GradeSegment> result = new ArrayList<>();
        for (BigDecimal start = BigDecimal.ZERO;
                start.compareTo(DISTANCE_M) < 0;
                start = start.add(step)) {
            result.add(new GradeSegment(start, start.add(step).min(DISTANCE_M), BigDecimal.ONE));
        }
        return result;
    }

    private static GeneratedCourseSaveCommand command() {
        return new GeneratedCourseSaveCommand(PATH, DISTANCE_M, null, profile());
    }

    private void awaitIdle() throws InterruptedException {
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
    }

    private int rows(long courseId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM course_basemaps WHERE course_id=?", Integer.class, courseId);
    }

    @Test
    void 생성코스를_저장하면_커밋_후_썸네일을_그려_저장한다() throws Exception {
        ROUTE.respond(200, THREE_FEATURES);

        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        assertThat(ROUTE.received()).singleElement().satisfies(received -> {
            assertThat(received.path()).isEqualTo("/internal/v1/basemaps");
            JsonNode body = jsonMapper.readTree(received.body());
            // 경로·코스 ID는 보내지 않고 범위·상세 수준·썸네일 축척(m/px)만 보낸다.
            assertThat(body.propertyNames()).containsExactly("bbox", "detail", "meters_per_pixel");
            assertThat(body.get("meters_per_pixel").doubleValue()).isPositive();
            assertThat(body.get("detail").stringValue()).isEqualTo("full");
        });
        assertThat(rows(courseId)).isEqualTo(1);
        String imageKey =
                jdbc.queryForObject(
                        "SELECT image_key FROM course_basemaps WHERE course_id=?", String.class, courseId);
        assertThat(imageKey).startsWith("images/course-basemap/" + courseId + "/").endsWith(".png");
        BufferedImage image = ImageIO.read(VOLUME.resolve(imageKey).toFile());
        assertThat(image.getWidth()).isEqualTo(600);
        assertThat(image.getHeight()).isEqualTo(900);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT render_version FROM course_basemaps WHERE course_id=?",
                                String.class,
                                courseId))
                .isEqualTo(CourseBasemapRunService.RENDER_VERSION);
    }

    @Test
    void 같은_경로를_다시_저장해도_Route는_한_번이다() throws Exception {
        ROUTE.respond(200, THREE_FEATURES);
        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        var again = courseService.saveGeneratedCourse(command());
        awaitIdle();

        assertThat(again.courseId()).isEqualTo(courseId);
        assertThat(ROUTE.received()).hasSize(1);
        assertThat(rows(courseId)).isEqualTo(1);
    }

    @Test
    void Route가_실패해도_코스는_저장되고_바탕_지도는_없다() throws Exception {
        ROUTE.respond(503, "{\"code\":\"NOT_READY\",\"message\":\"m\",\"details\":{}}");

        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        assertThat(ROUTE.received()).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses WHERE id=?", Integer.class, courseId))
                .isEqualTo(1);
        assertThat(rows(courseId)).isZero();
    }

    @Test
    void 저장이_롤백되면_Route를_부르지_않는다() throws Exception {
        ROUTE.respond(200, THREE_FEATURES);

        assertThatThrownBy(
                        () ->
                                transactionTemplate.executeWithoutResult(
                                        status -> {
                                            courseService.saveGeneratedCourse(command());
                                            throw new IllegalStateException("synthetic rollback");
                                        }))
                .isInstanceOf(IllegalStateException.class);
        awaitIdle();

        assertThat(ROUTE.received()).isEmpty();
    }
}
