package com.runway.backend.domain.course;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.course.dto.request.GeneratedCourseSaveCommand;
import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.dto.response.GeneratedCourseSaveResult;
import com.runway.backend.domain.course.service.CourseService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonGeographyMapper;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class GeneratedCourseSaveIntegrationTest extends SharedContextIntegrationSupport {
    private static final BigDecimal DISTANCE_M = new BigDecimal("2450.50");
    private static final GeoJsonLineString ROUTE =
            GeoJsonLineString.of(
                    List.of(List.of(129.0, 35.0), List.of(129.01, 35.01), List.of(129.02, 35.0)));

    /** 마지막 좌표만 다른 경로. 같은 경로는 재사용되므로 행을 따로 만들 때 쓴다. */
    private static GeoJsonLineString routeEndingAt(double lon) {
        return GeoJsonLineString.of(
                List.of(List.of(129.0, 35.0), List.of(129.01, 35.01), List.of(lon, 35.0)));
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CourseService courseService;
    @Autowired private JsonMapper jsonMapper;

    private long userId;
    private final List<Long> createdCourseIds = new ArrayList<>();

    @BeforeEach
    void seed() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('gen_course_user', 'hash', '생성코스', '2000-01-01', 'MALE', '01030009001', 'AGREE')
                        RETURNING id
                        """,
                        Long.class);
    }

    @AfterEach
    void cleanup() {
        for (Long id : createdCourseIds) {
            jdbc.update("DELETE FROM courses WHERE id = ?", id);
        }
        createdCourseIds.clear();
        jdbc.update("DELETE FROM users WHERE id = ?", userId);
    }

    /** 0부터 100m 간격으로 distance까지(마지막은 남은 거리). 경사는 i번째에 (i % 7 − 3) × 0.25. */
    private static List<GradeSegment> profile(String distance) {
        BigDecimal d = new BigDecimal(distance);
        BigDecimal step = BigDecimal.valueOf(100);
        List<GradeSegment> result = new ArrayList<>();
        int i = 0;
        for (BigDecimal start = BigDecimal.ZERO; start.compareTo(d) < 0; start = start.add(step)) {
            BigDecimal grade = BigDecimal.valueOf((i % 7) - 3).multiply(new BigDecimal("0.25"));
            result.add(new GradeSegment(start, start.add(step).min(d), grade));
            i++;
        }
        return result;
    }

    private static List<GradeSegment> sampleProfile() {
        return profile("2450.5");
    }

    private long save(GeneratedCourseSaveCommand command) {
        long id = courseService.saveGeneratedCourse(command).courseId();
        createdCourseIds.add(id);
        return id;
    }

    private int courseCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM courses", Integer.class);
    }

    private JsonNode storedProfile(long id) {
        return jsonMapper.readTree(
                jdbc.queryForObject(
                        "SELECT elevation_profile::text FROM courses WHERE id = ?",
                        String.class,
                        id));
    }

    /** 숫자는 BigDecimal 값으로(2.0 == 2), 나머지는 동등성으로 재귀 비교한다. 키 집합도 같아야 한다. */
    private static void assertJsonEquals(JsonNode actual, JsonNode expected, String path) {
        if (expected.isNumber()) {
            assertThat(actual.isNumber()).as(path).isTrue();
            assertThat(actual.decimalValue()).as(path).isEqualByComparingTo(expected.decimalValue());
        } else if (expected.isObject()) {
            assertThat(actual.isObject()).as(path).isTrue();
            assertThat(actual.propertyNames())
                    .as(path)
                    .containsExactlyInAnyOrderElementsOf(expected.propertyNames());
            for (String key : expected.propertyNames()) {
                assertJsonEquals(actual.get(key), expected.get(key), path + "." + key);
            }
        } else if (expected.isArray()) {
            assertThat(actual.isArray()).as(path).isTrue();
            assertThat(actual.size()).as(path).isEqualTo(expected.size());
            for (int i = 0; i < expected.size(); i++) {
                assertJsonEquals(actual.get(i), expected.get(i), path + "[" + i + "]");
            }
        } else {
            assertThat(actual).as(path).isEqualTo(expected);
        }
    }

    @Test
    void 생성코스_저장시_경로거리상승과_경사목록이_AI형식으로_저장된다() {
        long id =
                save(
                        new GeneratedCourseSaveCommand(
                                ROUTE, DISTANCE_M, new BigDecimal("10.10"), sampleProfile()));

        Map<String, Object> row =
                jdbc.queryForMap(
                        """
                        SELECT distance, elevation_gain, status::text AS status,
                               creator_id, source_session_id, region_code, description,
                               ST_X(start_position::geometry) AS start_lon,
                               ST_Y(start_position::geometry) AS start_lat,
                               ST_NPoints(route::geometry) AS route_points
                        FROM courses WHERE id = ?
                        """,
                        id);
        assertThat((BigDecimal) row.get("distance")).isEqualByComparingTo("2450.50");
        assertThat((BigDecimal) row.get("elevation_gain")).isEqualByComparingTo("10.10");
        assertThat(row.get("status")).isEqualTo("ACTIVE");
        assertThat(row.get("creator_id")).isNull();
        assertThat(row.get("source_session_id")).isNull();
        assertThat(row.get("region_code")).isNull();
        assertThat(row.get("description")).isNull();
        assertThat(((Number) row.get("start_lon")).doubleValue()).isEqualTo(129.0);
        assertThat(((Number) row.get("start_lat")).doubleValue()).isEqualTo(35.0);
        assertThat(((Number) row.get("route_points")).intValue()).isEqualTo(3);

        // 최상위가 AI PlanGradeSegment 목록이고, 처음·끝 조각이 리터럴과 같다(키는 정확히 3개).
        JsonNode stored = storedProfile(id);
        assertThat(stored.isArray()).isTrue();
        assertThat(stored.size()).isEqualTo(25);
        assertJsonEquals(
                stored.get(0),
                jsonMapper.readTree(
                        "{\"startDistanceM\":0,\"endDistanceM\":100,\"gradePercent\":-0.75}"),
                "$[0]");
        assertJsonEquals(
                stored.get(24),
                jsonMapper.readTree(
                        "{\"startDistanceM\":2400,\"endDistanceM\":2450.5,\"gradePercent\":0}"),
                "$[24]");
        // 전체가 입력과 같다.
        assertJsonEquals(
                stored, jsonMapper.readTree(jsonMapper.writeValueAsString(sampleProfile())), "$");
    }

    @Test
    void 코스상세조회에서_저장한_경사목록이_반환된다() throws Exception {
        long id =
                save(
                        new GeneratedCourseSaveCommand(
                                ROUTE, DISTANCE_M, new BigDecimal("10.10"), sampleProfile()));

        String body =
                mockMvc.perform(
                                get("/api/v1/courses/{courseId}", id)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.distanceM").value(2450.5))
                        .andExpect(jsonPath("$.elevationGainM").value(10.1))
                        .andExpect(jsonPath("$.elevationProfile", hasSize(25)))
                        .andExpect(jsonPath("$.elevationProfile[0].startDistanceM").value(0))
                        .andExpect(jsonPath("$.elevationProfile[0].endDistanceM").value(100))
                        .andExpect(jsonPath("$.elevationProfile[0].gradePercent").value(-0.75))
                        .andExpect(jsonPath("$.elevationProfile[24].endDistanceM").value(2450.5))
                        .andExpect(jsonPath("$.startPosition.coordinates[0]").value(129.0))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        assertJsonEquals(
                jsonMapper.readTree(body).get("elevationProfile"),
                jsonMapper.readTree(jsonMapper.writeValueAsString(sampleProfile())),
                "$.elevationProfile");
    }

    @Test
    void 영값의_극단적_스케일도_0으로_정규화해_저장하고_상세조회가_성공한다() throws Exception {
        // 정규화 없이 저장하면 jsonb가 0을 1000자 넘게 펼쳐 C03 readTree가 숫자 길이 한도로 실패한다
        List<GradeSegment> extreme = new ArrayList<>(sampleProfile());
        extreme.set(
                0,
                new GradeSegment(
                        new BigDecimal("0E-2000"), new BigDecimal("100"), new BigDecimal("0E-2000")));
        long id = save(new GeneratedCourseSaveCommand(ROUTE, DISTANCE_M, null, extreme));

        String stored =
                jdbc.queryForObject(
                        "SELECT elevation_profile::text FROM courses WHERE id = ?", String.class, id);
        assertThat(stored).doesNotContain("00000000000");

        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", id)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.elevationProfile[0].startDistanceM").value(0))
                .andExpect(jsonPath("$.elevationProfile[0].gradePercent").value(0));
    }

    @Test
    void 거리와_누적상승은_DB와같이_소수2자리로_반올림한뒤_검증하고_저장한다() {
        int before = courseCount();
        // 2451.495 → 2451.50. 마지막 끝 2450.495와의 차이 1.005m > 1m 이므로 거절(반올림 전 기준이면 통과했을 입력)
        assertThatThrownBy(
                        () ->
                                courseService.saveGeneratedCourse(
                                        new GeneratedCourseSaveCommand(
                                                ROUTE,
                                                new BigDecimal("2451.495"),
                                                null,
                                                profile("2450.495"))))
                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);
        // 0.004m → 0.00 → 0 이하로 거절
        assertThatThrownBy(
                        () ->
                                courseService.saveGeneratedCourse(
                                        new GeneratedCourseSaveCommand(
                                                ROUTE,
                                                new BigDecimal("0.004"),
                                                null,
                                                profile("0.004"))))
                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);
        // 음수 누적 상승은 반올림으로 0이 되더라도 거절
        assertThatThrownBy(
                        () ->
                                courseService.saveGeneratedCourse(
                                        new GeneratedCourseSaveCommand(
                                                ROUTE,
                                                DISTANCE_M,
                                                new BigDecimal("-0.004"),
                                                sampleProfile())))
                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);
        // 상한·지수 경계: 도메인 예외로 빠르게 거절
        assertTimeoutPreemptively(
                Duration.ofSeconds(5),
                () -> {
                    for (GeneratedCourseSaveCommand invalid :
                            List.of(
                                    new GeneratedCourseSaveCommand(
                                            ROUTE, new BigDecimal("1E+1000"), null, sampleProfile()),
                                    new GeneratedCourseSaveCommand(
                                            ROUTE,
                                            new BigDecimal("1E-100000000"),
                                            null,
                                            sampleProfile()),
                                    new GeneratedCourseSaveCommand(
                                            ROUTE,
                                            DISTANCE_M,
                                            new BigDecimal("100000000.00"),
                                            sampleProfile()),
                                    new GeneratedCourseSaveCommand(
                                            ROUTE,
                                            DISTANCE_M,
                                            new BigDecimal("1E+1000"),
                                            sampleProfile()),
                                    new GeneratedCourseSaveCommand(
                                            ROUTE,
                                            DISTANCE_M,
                                            new BigDecimal("-1E-100000000"),
                                            sampleProfile()))) {
                        assertThatThrownBy(() -> courseService.saveGeneratedCourse(invalid))
                                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);
                    }
                });
        assertThat(courseCount()).isEqualTo(before);

        // 누적 상승 상한(99999999.99)은 허용, 지수가 매우 작은 양수는 0.00으로 저장
        long maxGainId =
                save(
                        new GeneratedCourseSaveCommand(
                                routeEndingAt(129.021),
                                DISTANCE_M,
                                new BigDecimal("99999999.99"),
                                sampleProfile()));
        long tinyGainId =
                assertTimeoutPreemptively(
                        Duration.ofSeconds(5),
                        () ->
                                save(
                                        new GeneratedCourseSaveCommand(
                                                routeEndingAt(129.022),
                                                DISTANCE_M,
                                                new BigDecimal("1E-100000000"),
                                                sampleProfile())));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT elevation_gain FROM courses WHERE id = ?",
                                BigDecimal.class,
                                maxGainId))
                .isEqualByComparingTo("99999999.99");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT elevation_gain FROM courses WHERE id = ?",
                                BigDecimal.class,
                                tinyGainId))
                .isEqualByComparingTo("0.00");

        // 2450.504 → 2450.50, 누적 상승 10.105 → 10.11 로 저장
        long id =
                save(
                        new GeneratedCourseSaveCommand(
                                routeEndingAt(129.023),
                                new BigDecimal("2450.504"),
                                new BigDecimal("10.105"),
                                sampleProfile()));
        Map<String, Object> row =
                jdbc.queryForMap("SELECT distance, elevation_gain FROM courses WHERE id = ?", id);
        assertThat((BigDecimal) row.get("distance")).isEqualByComparingTo("2450.50");
        assertThat((BigDecimal) row.get("elevation_gain")).isEqualByComparingTo("10.11");
    }

    @Test
    void 잘못된_경사데이터는_저장하지않고_거절한다() {
        int before = courseCount();

        List<GradeSegment> gap = new ArrayList<>(sampleProfile());
        gap.set(3, new GradeSegment(new BigDecimal("300"), new BigDecimal("399"), BigDecimal.ONE));
        List<GradeSegment> nullGrade = new ArrayList<>(sampleProfile());
        nullGrade.set(5, new GradeSegment(new BigDecimal("500"), new BigDecimal("600"), null));

        for (GeneratedCourseSaveCommand invalid :
                List.of(
                        // 총거리 불일치(마지막 끝 2450.5 vs 코스 2000)
                        new GeneratedCourseSaveCommand(
                                ROUTE, new BigDecimal("2000.00"), null, sampleProfile()),
                        // 조각 사이 틈
                        new GeneratedCourseSaveCommand(ROUTE, DISTANCE_M, null, gap),
                        // 미확인 경사 null 불허(산출 측 보간)
                        new GeneratedCourseSaveCommand(ROUTE, DISTANCE_M, null, nullGrade),
                        // 프로필 누락·빈 목록, 음수 누적 상승, 0 이하·상한 초과 거리, 경로 누락
                        new GeneratedCourseSaveCommand(ROUTE, DISTANCE_M, null, null),
                        new GeneratedCourseSaveCommand(ROUTE, DISTANCE_M, null, List.of()),
                        new GeneratedCourseSaveCommand(
                                ROUTE, DISTANCE_M, new BigDecimal("-1"), sampleProfile()),
                        new GeneratedCourseSaveCommand(
                                ROUTE, BigDecimal.ZERO, null, sampleProfile()),
                        new GeneratedCourseSaveCommand(
                                ROUTE, new BigDecimal("10000000000.00"), null, sampleProfile()),
                        new GeneratedCourseSaveCommand(null, DISTANCE_M, null, sampleProfile()))) {
            assertThatThrownBy(() -> courseService.saveGeneratedCourse(invalid))
                    .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);
        }
        assertThatThrownBy(() -> courseService.saveGeneratedCourse(null))
                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);

        assertThat(courseCount()).isEqualTo(before);
    }

    private GeneratedCourseSaveResult saveResult(GeneratedCourseSaveCommand command) {
        GeneratedCourseSaveResult result = courseService.saveGeneratedCourse(command);
        createdCourseIds.add(result.courseId());
        return result;
    }

    private int countRoute(GeoJsonLineString route) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM courses WHERE ST_AsEWKB(route::geometry) = ST_AsEWKB(ST_GeogFromText(?)::geometry)",
                Integer.class,
                GeoJsonGeographyMapper.toEwkt(route));
    }

    @Test
    void T5_같은_경로를_다시_저장하면_같은_ACTIVE_코스를_재사용한다() {
        GeoJsonLineString route = routeEndingAt(129.031);
        var first = saveResult(new GeneratedCourseSaveCommand(route, DISTANCE_M, null, sampleProfile()));
        var second = saveResult(new GeneratedCourseSaveCommand(route, DISTANCE_M, null, sampleProfile()));

        assertThat(first.reused()).isFalse();
        assertThat(second.reused()).isTrue();
        assertThat(second.courseId()).isEqualTo(first.courseId());
        assertThat(countRoute(route)).isEqualTo(1);
    }

    @Test
    void T6_같은_경로를_동시에_저장해도_한_행만_생긴다() throws Exception {
        GeoJsonLineString route = routeEndingAt(129.032);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<GeneratedCourseSaveResult>> futures = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    return courseService.saveGeneratedCourse(
                                            new GeneratedCourseSaveCommand(
                                                    route, DISTANCE_M, null, sampleProfile()));
                                }));
            }
            ready.await(10, TimeUnit.SECONDS);
            start.countDown();
            var a = futures.get(0).get(30, TimeUnit.SECONDS);
            var b = futures.get(1).get(30, TimeUnit.SECONDS);
            createdCourseIds.add(a.courseId());

            assertThat(a.courseId()).isEqualTo(b.courseId());
            assertThat(List.of(a.reused(), b.reused())).containsExactlyInAnyOrder(false, true);
            assertThat(countRoute(route)).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void T7_좌표가_조금이라도_다르거나_역방향이면_별도_코스로_저장한다() {
        GeoJsonLineString route = routeEndingAt(129.033);
        GeoJsonLineString shifted = routeEndingAt(Math.nextUp(129.033));
        List<List<Double>> reversedPoints = new ArrayList<>(route.coordinates()).reversed();
        GeoJsonLineString reversed = GeoJsonLineString.of(reversedPoints);

        long base = saveResult(new GeneratedCourseSaveCommand(route, DISTANCE_M, null, sampleProfile())).courseId();
        var other = saveResult(new GeneratedCourseSaveCommand(shifted, DISTANCE_M, null, sampleProfile()));
        var back = saveResult(new GeneratedCourseSaveCommand(reversed, DISTANCE_M, null, sampleProfile()));

        assertThat(other.reused()).isFalse();
        assertThat(back.reused()).isFalse();
        assertThat(List.of(base, other.courseId(), back.courseId())).doesNotHaveDuplicates();
    }

    @Test
    void 리뷰A2_좌표가_같으면_거리값이_달라도_같은_경로로_본다() {
        GeoJsonLineString active = routeEndingAt(129.036);
        long id = save(new GeneratedCourseSaveCommand(active, DISTANCE_M, null, sampleProfile()));
        var reused =
                saveResult(
                        new GeneratedCourseSaveCommand(
                                active, new BigDecimal("2400.00"), null, profile("2400")));
        assertThat(reused.reused()).isTrue();
        assertThat(reused.courseId()).isEqualTo(id);

        GeoJsonLineString blocked = routeEndingAt(129.037);
        long blockedId = save(new GeneratedCourseSaveCommand(blocked, DISTANCE_M, null, sampleProfile()));
        jdbc.update("UPDATE courses SET status = 'BLOCKED' WHERE id = ?", blockedId);
        assertThatThrownBy(
                        () ->
                                courseService.saveGeneratedCourse(
                                        new GeneratedCourseSaveCommand(
                                                blocked, new BigDecimal("2400.00"), null, profile("2400"))))
                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.COURSE_INACCESSIBLE);
        assertThat(countRoute(blocked)).isEqualTo(1);
    }

    @Test
    void T7_완전_일치_경로가_BLOCKED나_MERGED면_새로_만들지_않고_COURSE_INACCESSIBLE() {
        for (String status : List.of("BLOCKED", "MERGED")) {
            GeoJsonLineString route = routeEndingAt(status.equals("BLOCKED") ? 129.034 : 129.035);
            long id = save(new GeneratedCourseSaveCommand(route, DISTANCE_M, null, sampleProfile()));
            jdbc.update("UPDATE courses SET status = ?::courses_status_enum WHERE id = ?", status, id);

            assertThatThrownBy(
                            () ->
                                    courseService.saveGeneratedCourse(
                                            new GeneratedCourseSaveCommand(
                                                    route, DISTANCE_M, null, sampleProfile())))
                    .isInstanceOf(ApiException.class)
                    .extracting("errorCode")
                    .isEqualTo(ErrorCode.COURSE_INACCESSIBLE);
            assertThat(countRoute(route)).as(status).isEqualTo(1);
        }
    }
}
