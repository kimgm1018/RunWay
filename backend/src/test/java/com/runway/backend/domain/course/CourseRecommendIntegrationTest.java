package com.runway.backend.domain.course;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.infrastructure.route.FakeRouteServer;
import com.runway.backend.infrastructure.route.RouteFixtures;
import com.runway.backend.support.SharedPostgres;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

/**
 * AC-1~4·6: 실제 Spring 구성(Route HTTP 어댑터 + 합성 DEM)으로 C01 전체 흐름을 확인한다. Route는 루프백 가짜 서버다.
 * 합성 DEM(area.tif)이 덮는 좌표를 쓰며 실제 GPS 자료가 아니다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class CourseRecommendIntegrationTest {

    /** area.tif 범위 안의 합성 출발점. */
    private static final double LAT = 47.0;
    private static final double LON = 12.0;
    private static final Path AREA_DEM = Path.of("src/test/resources/course-grade/dem/area.tif");
    private static final FakeRouteServer ROUTE = new FakeRouteServer();
    private static final JsonMapper JSON = JsonMapper.builder().build();

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(CourseRecommendIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.course.route.mode", () -> "http");
        registry.add("runway.course.route.base-url", () -> ROUTE.baseUri().toString());
        String sha256 =
                HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest(Files.readAllBytes(AREA_DEM)));
        registry.add("runway.course.dem.path", () -> AREA_DEM.toAbsolutePath().toString());
        registry.add("runway.course.dem.sha256", () -> sha256);
    }

    @AfterAll
    static void stopRoute() {
        ROUTE.close();
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long userId;

    @BeforeEach
    void seed() {
        ROUTE.reset();
        jdbc.update("DELETE FROM users WHERE login_id LIKE 'course_rec_%'");
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('course_rec_user', 'hash', '추천유저', '2000-01-01', 'MALE', '01030002001', 'AGREEE')
                        RETURNING id
                        """,
                        Long.class);
    }

    private org.springframework.test.web.servlet.ResultActions recommend(String body)
            throws Exception {
        return mockMvc.perform(
                post("/api/v1/courses/recommendations")
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private static String request(double latitude, double longitude) {
        return """
                {"latitude": %s, "longitude": %s, "distanceKm": 5.0,
                 "filters": {"river": true, "avoidMajorRoad": null}}
                """
                .formatted(latitude, longitude);
    }

    @Test
    void C01_Route후보에_DEM경사와_설명점수를_조합해_반환한다() throws Exception {
        ROUTE.respond(200, JSON.writeValueAsString(RouteFixtures.success(LAT, LON, 2, 1)));

        recommend(request(LAT, LON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courses", hasSize(2)))
                .andExpect(jsonPath("$.courses[0].index").value(0))
                .andExpect(jsonPath("$.courses[1].index").value(1))
                .andExpect(jsonPath("$.courses[0].id").doesNotExist())
                .andExpect(
                        jsonPath("$.courses[0].candidateToken")
                                .value(org.hamcrest.Matchers.matchesPattern("v1\\.\\d+\\.[A-Za-z0-9_-]{43}")))
                .andExpect(
                        jsonPath("$.courses[1].candidateToken")
                                .value(org.hamcrest.Matchers.matchesPattern("v1\\.\\d+\\.[A-Za-z0-9_-]{43}")))
                .andExpect(jsonPath("$.courses[0].distanceM").value(5000.0))
                .andExpect(jsonPath("$.courses[0].route.type").value("LineString"))
                .andExpect(jsonPath("$.courses[0].route.coordinates[0]", contains(LON, LAT)))
                .andExpect(jsonPath("$.courses[0].elevationProfile", hasSize(greaterThan(0))))
                .andExpect(jsonPath("$.courses[0].elevationProfile[0].startDistanceM").value(0.0))
                .andExpect(jsonPath("$.courses[0].elevationProfile[0].endDistanceM").value(100.0))
                .andExpect(jsonPath("$.courses[0].elevationProfile[0].gradePercent").isNumber())
                .andExpect(jsonPath("$.courses[0].summary").value("강변을 많이 지나는 코스예요."))
                .andExpect(jsonPath("$.courses[0].reasons", contains("강변 구간이 40%예요")))
                .andExpect(jsonPath("$.courses[0].caveats", contains("계단이 1곳 있어요")))
                .andExpect(jsonPath("$.courses[0].score").value(0.96))
                .andExpect(jsonPath("$.courses[0].scoreTerms[0].term").value("distance_fit"))
                .andExpect(jsonPath("$.courses[0].scoreTerms[0].featureValue").value(0.96))
                .andExpect(jsonPath("$.courses[0].scoreTerms[0].feature_value").doesNotExist())
                .andExpect(jsonPath("$.notices", contains("이 주변은 공원 정보가 일부만 있어요")))
                .andExpect(jsonPath("$.nextSeed").value(25));

        Assertions.assertThat(ROUTE.received()).singleElement().satisfies(received -> {
            var sent = JSON.readTree(received.body());
            Assertions.assertThat(sent.get("lat").doubleValue()).isEqualTo(LAT);
            Assertions.assertThat(sent.get("filters").get("river").booleanValue()).isTrue();
            Assertions.assertThat(sent.get("filters").get("avoid_major_road").booleanValue()).isFalse();
            Assertions.assertThat(received.headers()).doesNotContainKey("authorization");
        });
    }

    @Test
    void C01_부산밖_좌표도_Route가_판정하고_OUT_OF_AREA는_422_사유로_전달한다() throws Exception {
        ROUTE.respond(422, "{\"code\":\"OUT_OF_AREA\",\"message\":\"bbox debug\",\"details\":{}}");

        recommend(request(37.5665, 126.9780))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"))
                .andExpect(jsonPath("$.message").value("출발 위치가 서비스 지역 밖입니다."))
                .andExpect(jsonPath("$.details.reason").value("OUT_OF_AREA"));

        Assertions.assertThat(ROUTE.received()).hasSize(1);
    }

    @Test
    void C01_Route_과부하는_503_ROUTE_BUSY이고_상류_문구를_노출하지_않는다() throws Exception {
        ROUTE.respond(503, "{\"code\":\"BUSY\",\"message\":\"queue full worker-2\",\"details\":{\"debug\":\"x\"}}");

        recommend(request(LAT, LON))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.details.reason").value("ROUTE_BUSY"))
                .andExpect(content().string(not(containsString("worker-2"))));

        Assertions.assertThat(ROUTE.received()).hasSize(1);
    }

    @Test
    void C01_Route후보가_DEM범위밖이면_GRADE_UNAVAILABLE이다() throws Exception {
        // 출발점은 DEM 밖(부산). Route는 성공했지만 경사를 계산할 고도가 없다.
        ROUTE.respond(
                200,
                JSON.writeValueAsString(
                        RouteFixtures.success(RouteFixtures.START_LAT, RouteFixtures.START_LON, 1, 1)));

        recommend(request(RouteFixtures.START_LAT, RouteFixtures.START_LON))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.details.reason").value("GRADE_UNAVAILABLE"));
    }

    @Test
    void C01_위경도_형식오류는_Route를_호출하지_않고_422다() throws Exception {
        recommend(request(91, LON))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        Assertions.assertThat(ROUTE.received()).isEmpty();
    }
}
