package com.runway.backend.domain.course;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.infrastructure.route.FakeRouteServer;
import com.runway.backend.infrastructure.route.RouteFixtures;
import com.runway.backend.support.SharedPostgres;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
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
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * T-2·T-4·T-5: C01로 받은 후보를 C10으로 그대로 보내 저장하는 전체 흐름. Route는 루프백 가짜 서버, DEM은 합성 area.tif다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class GeneratedCourseSelectIntegrationTest {

    private static final double LAT = 47.0;
    private static final double LON = 12.0;
    private static final Path AREA_DEM = Path.of("src/test/resources/course-grade/dem/area.tif");
    private static final FakeRouteServer ROUTE = new FakeRouteServer();
    private static final JsonMapper JSON = JsonMapper.builder().build();

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(GeneratedCourseSelectIntegrationTest.class);

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
    private long otherUserId;

    @BeforeEach
    void seed() {
        ROUTE.reset();
        jdbc.update("DELETE FROM courses");
        jdbc.update("DELETE FROM users WHERE login_id LIKE 'course_sel_%'");
        userId = insertUser("course_sel_a", "선택A", "01030003001");
        otherUserId = insertUser("course_sel_b", "선택B", "01030003002");
    }

    @AfterEach
    void cleanup() {
        jdbc.update("DELETE FROM courses");
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREEE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    /** C01을 호출해 첫 후보를 앱이 받은 그대로(JSON 노드) 돌려준다. */
    private ObjectNode recommendFirstCandidate(long user) throws Exception {
        ROUTE.respond(200, JSON.writeValueAsString(RouteFixtures.success(LAT, LON, 2, 1)));
        String body =
                mockMvc.perform(
                                post("/api/v1/courses/recommendations")
                                        .header("Authorization", SecurityTestSupport.bearer(user))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"latitude\": %s, \"longitude\": %s, \"distanceKm\": 5.0}"
                                                        .formatted(LAT, LON)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return (ObjectNode) JSON.readTree(body).get("courses").get(0);
    }

    /** 앱이 C10에 보내는 본문: 후보의 서명·경로·거리·경사만. */
    private static ObjectNode selectBody(JsonNode candidate) {
        ObjectNode body = JSON.createObjectNode();
        body.set("candidateToken", candidate.get("candidateToken"));
        body.set("route", candidate.get("route").deepCopy());
        body.set("distanceM", candidate.get("distanceM"));
        body.set("elevationProfile", candidate.get("elevationProfile").deepCopy());
        return body;
    }

    private ResultActions select(long user, JsonNode body) throws Exception {
        return mockMvc.perform(
                post("/api/v1/courses/generated")
                        .header("Authorization", SecurityTestSupport.bearer(user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(body)));
    }

    private int courseCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM courses", Integer.class);
    }

    @Test
    void T2_C01후보를_그대로_보내면_경로_거리_경사와_함께_저장된다() throws Exception {
        ObjectNode candidate = recommendFirstCandidate(userId);

        String response =
                select(userId, selectBody(candidate))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.reused").value(false))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long courseId = JSON.readTree(response).get("courseId").longValue();

        // AC-1: 기본 유효 시간 30분(runway.course.candidate-ttl 기본값)
        long expiresAt = Long.parseLong(candidate.get("candidateToken").stringValue().split("\\.")[1]);
        assertThat(expiresAt - java.time.Instant.now().getEpochSecond()).isBetween(30 * 60L - 60, 30 * 60L);

        Map<String, Object> row =
                jdbc.queryForMap(
                        """
                        SELECT ST_AsGeoJSON(route::geometry, 15) AS route, distance,
                               elevation_profile::text AS profile, status::text AS status,
                               creator_id, source_session_id, region_code, description, elevation_gain,
                               ST_X(start_position::geometry) AS start_lon,
                               ST_Y(start_position::geometry) AS start_lat,
                               created_at = updated_at AS unchanged
                        FROM courses WHERE id = ?
                        """,
                        courseId);
        JsonNode route = JSON.readTree((String) row.get("route"));
        // 저장 좌표가 후보 좌표와 double 값까지 같다(ST_AsGeoJSON 기본 9자리 절삭을 피하려고 15자리로 읽는다).
        JsonNode expectedCoordinates = candidate.get("route").get("coordinates");
        assertThat(route.get("coordinates").size()).isEqualTo(expectedCoordinates.size());
        for (int i = 0; i < expectedCoordinates.size(); i++) {
            for (int axis = 0; axis < 2; axis++) {
                assertThat(route.get("coordinates").get(i).get(axis).doubleValue())
                        .as("coordinates[%d][%d]", i, axis)
                        .isEqualTo(expectedCoordinates.get(i).get(axis).doubleValue());
            }
        }
        assertThat((BigDecimal) row.get("distance"))
                .isEqualByComparingTo(candidate.get("distanceM").decimalValue());
        JsonNode profile = JSON.readTree((String) row.get("profile"));
        assertThat(profile.size()).isEqualTo(candidate.get("elevationProfile").size());
        for (int i = 0; i < profile.size(); i++) {
            for (String key : new String[] {"startDistanceM", "endDistanceM", "gradePercent"}) {
                assertThat(profile.get(i).get(key).decimalValue())
                        .as("[%d].%s", i, key)
                        .isEqualByComparingTo(
                                candidate.get("elevationProfile").get(i).get(key).decimalValue());
            }
        }
        assertThat(row.get("status")).isEqualTo("ACTIVE");
        assertThat(row.get("creator_id")).isNull();
        assertThat(row.get("source_session_id")).isNull();
        assertThat(row.get("region_code")).isNull();
        assertThat(row.get("description")).isNull();
        assertThat(row.get("elevation_gain")).isNull();
        assertThat(((Number) row.get("start_lon")).doubleValue())
                .isEqualTo(candidate.get("route").get("coordinates").get(0).get(0).doubleValue());
        assertThat(((Number) row.get("start_lat")).doubleValue())
                .isEqualTo(candidate.get("route").get("coordinates").get(0).get(1).doubleValue());
        assertThat(row.get("unchanged")).isEqualTo(true);
    }

    @Test
    void T5_같은_후보를_다시_보내면_같은_코스를_돌려준다() throws Exception {
        ObjectNode body = selectBody(recommendFirstCandidate(userId));

        long first =
                JSON.readTree(
                                select(userId, body)
                                        .andExpect(status().isOk())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString())
                        .get("courseId")
                        .longValue();
        select(userId, body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseId").value(first))
                .andExpect(jsonPath("$.reused").value(true));
        assertThat(courseCount()).isEqualTo(1);
    }

    @Test
    void T4_변조하거나_남의_후보면_422_COURSE_CANDIDATE_INVALID이고_저장하지_않는다() throws Exception {
        ObjectNode candidate = recommendFirstCandidate(userId);

        ObjectNode movedPoint = selectBody(candidate);
        ArrayNode coordinates = (ArrayNode) movedPoint.get("route").get("coordinates");
        ArrayNode second = (ArrayNode) coordinates.get(1);
        second.set(0, JSON.getNodeFactory().numberNode(second.get(0).doubleValue() + 0.0001));

        ObjectNode regraded = selectBody(candidate);
        ObjectNode firstSegment = (ObjectNode) regraded.get("elevationProfile").get(0);
        firstSegment.put("gradePercent", firstSegment.get("gradePercent").decimalValue().add(BigDecimal.ONE));

        ObjectNode longer = selectBody(candidate);
        longer.put("distanceM", candidate.get("distanceM").decimalValue().add(new BigDecimal("0.01")));

        ObjectNode forged = selectBody(candidate);
        forged.put("candidateToken", "v1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

        for (JsonNode body : new JsonNode[] {movedPoint, regraded, longer, forged}) {
            select(userId, body)
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("COURSE_CANDIDATE_INVALID"));
        }
        // 다른 사용자가 받은 후보를 그대로 보내도 거절한다.
        select(otherUserId, selectBody(candidate))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("COURSE_CANDIDATE_INVALID"));
        assertThat(courseCount()).isZero();
    }

    @Test
    void T4_필수값이_없거나_형식이_틀리면_400_VALIDATION_ERROR() throws Exception {
        ObjectNode candidate = recommendFirstCandidate(userId);

        for (String missing :
                new String[] {"candidateToken", "route", "distanceM", "elevationProfile"}) {
            ObjectNode body = selectBody(candidate);
            body.remove(missing);
            select(userId, body)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        ObjectNode wrongType = selectBody(candidate);
        ((ObjectNode) wrongType.get("route")).put("type", "Point");
        select(userId, wrongType)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        ObjectNode emptyProfile = selectBody(candidate);
        emptyProfile.set("elevationProfile", JSON.createArrayNode());
        select(userId, emptyProfile)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        assertThat(courseCount()).isZero();
    }

    @Test
    void 리뷰A1_B1_거대한_지수_숫자나_과도한_좌표는_서명_계산_전에_400으로_거절한다() throws Exception {
        ObjectNode candidate = recommendFirstCandidate(userId);

        // JSON 숫자 리터럴을 그대로 넣기 위해 문자열로 본문을 만든다(1e999999999는 펼치면 10억 자).
        String token = candidate.get("candidateToken").stringValue();
        String route = JSON.writeValueAsString(candidate.get("route"));
        String profile = JSON.writeValueAsString(candidate.get("elevationProfile"));
        String distance = candidate.get("distanceM").toString();
        List<String> bodies =
                List.of(
                        body(token, route, "1e999999999", profile),
                        body(token, route, "1e-999999999", profile),
                        body(
                                token,
                                route,
                                distance,
                                "[{\"startDistanceM\":0,\"endDistanceM\":100,\"gradePercent\":1e999999999}]"),
                        // B-2: 경사 값 null은 서명 문제가 아니라 형식 오류다
                        body(
                                token,
                                route,
                                distance,
                                "[{\"startDistanceM\":0,\"endDistanceM\":100,\"gradePercent\":null}]"),
                        body(token, routeWithPositions(3_001), distance, profile));
        long started = System.nanoTime();
        for (String raw : bodies) {
            mockMvc.perform(
                            post("/api/v1/courses/generated")
                                    .header("Authorization", SecurityTestSupport.bearer(userId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(raw))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        assertThat(java.time.Duration.ofNanos(System.nanoTime() - started)).isLessThan(java.time.Duration.ofSeconds(10));
        assertThat(courseCount()).isZero();
    }

    private static String body(String token, String route, String distance, String profile) {
        return "{\"candidateToken\":\"%s\",\"route\":%s,\"distanceM\":%s,\"elevationProfile\":%s}"
                .formatted(token, route, distance, profile);
    }

    private static String routeWithPositions(int count) {
        StringBuilder out = new StringBuilder("{\"type\":\"LineString\",\"coordinates\":[");
        for (int i = 0; i < count; i++) {
            out.append(i == 0 ? "" : ",").append("[12.0,").append(47.0 + i * 1e-6).append(']');
        }
        return out.append("]}").toString();
    }

    @Test
    void AC4_후보의_다른_필드를_함께_보내도_무시하고_저장한다() throws Exception {
        ObjectNode candidate = recommendFirstCandidate(userId);
        // 앱이 C01 후보 객체를 통째로 보내는 경우(summary·score 등 포함)
        ObjectNode whole = candidate.deepCopy();

        select(userId, whole)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reused").value(false));
        assertThat(courseCount()).isEqualTo(1);
    }

    @Test
    void 인증이_없으면_401() throws Exception {
        mockMvc.perform(
                        post("/api/v1/courses/generated")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
