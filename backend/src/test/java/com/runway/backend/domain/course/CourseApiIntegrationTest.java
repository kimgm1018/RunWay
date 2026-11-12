package com.runway.backend.domain.course;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.course.recommend.CourseRecommendPort;
import com.runway.backend.domain.course.recommend.StubCourseRecommendAdapter;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.math.BigDecimal;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class CourseApiIntegrationTest {

    private static final String DESC_PREFIX = "[course-api-test]";
    private static final String ROUTE_EWKT = "SRID=4326;LINESTRING(129 35, 129.001 35.001)";
    private static final String START_EWKT = "SRID=4326;POINT(129 35)";
    private static final BigDecimal DISTANCE_M = new BigDecimal("5000.00");

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(CourseApiIntegrationTest.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        // C01은 개발용 스텁 모드로 확인한다. Route HTTP 흐름은 CourseRecommendIntegrationTest가 맡는다.
        registry.add("runway.course.route.mode", () -> "stub");
        registry.add("runway.images.volume-path", () -> IMAGE_VOLUME.toString());
    }

    @org.junit.jupiter.api.io.TempDir static java.nio.file.Path IMAGE_VOLUME;

    /** C01 생성기 호출 시점의 트랜잭션 여부를 기록한다(AC-10). 결과는 스텁 그대로다. */
    @TestConfiguration
    static class RecordingRecommendPortConfig {
        static final AtomicReference<Boolean> TRANSACTION_ACTIVE = new AtomicReference<>();

        @Bean
        @Primary
        CourseRecommendPort recordingCourseRecommendPort() {
            var stub = new StubCourseRecommendAdapter();
            return (command, deadline) -> {
                TRANSACTION_ACTIVE.set(TransactionSynchronizationManager.isActualTransactionActive());
                return stub.recommend(command, deadline);
            };
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long userId;
    private long activeCourseId;
    private long mergedCourseId;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM course_bookmarks");
        jdbc.update("DELETE FROM course_environment_tags");
        jdbc.update(
                "UPDATE courses SET merged_into_course_id = NULL WHERE description LIKE ?",
                DESC_PREFIX + "%");
        jdbc.update("DELETE FROM courses WHERE description LIKE ?", DESC_PREFIX + "%");
        jdbc.update("DELETE FROM users WHERE login_id LIKE 'course_api_%'");

        userId = insertUser("course_api_user", "코스유저", "01030001001");
        activeCourseId = insertCourse(DESC_PREFIX + " active", "ACTIVE", null, DISTANCE_M);
        insertEnvironmentTag(activeCourseId, "PARK");

        long targetCourseId = insertCourse(DESC_PREFIX + " target", "ACTIVE", null, DISTANCE_M);
        mergedCourseId =
                insertCourse(
                        DESC_PREFIX + " merged",
                        "MERGED",
                        targetCourseId,
                        new BigDecimal("3000.00"));
    }

    @Test
    void C03_상세_GeoJSON과거리상태_토큰없으면401_없으면404() throws Exception {
        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(activeCourseId))
                .andExpect(jsonPath("$.description").value(DESC_PREFIX + " active"))
                .andExpect(jsonPath("$.route.type").value("LineString"))
                .andExpect(jsonPath("$.route.coordinates[0][0]").value(129.0))
                .andExpect(jsonPath("$.route.coordinates[0][1]").value(35.0))
                .andExpect(jsonPath("$.route.coordinates[1][0]").value(129.001))
                .andExpect(jsonPath("$.route.coordinates[1][1]").value(35.001))
                .andExpect(jsonPath("$.startPosition.type").value("Point"))
                .andExpect(jsonPath("$.startPosition.coordinates[0]").value(129.0))
                .andExpect(jsonPath("$.startPosition.coordinates[1]").value(35.0))
                .andExpect(jsonPath("$.distanceM").value(5000.0))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.mergedIntoCourseId").value(nullValue()))
                .andExpect(jsonPath("$.environmentTags[0]").value("PARK"))
                .andExpect(jsonPath("$.estimatedDurationSec").doesNotExist())
                .andExpect(jsonPath("$.myAlias").value(nullValue()));

        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", mergedCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("MERGED"))
                .andExpect(jsonPath("$.mergedIntoCourseId").isNumber());

        mockMvc.perform(get("/api/v1/courses/{courseId}", activeCourseId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", 9_999_999L)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COURSE_NOT_FOUND"));
    }

    @Test
    void C03_바탕지도가_없으면_basemap은_null() throws Exception {
        MvcResult result =
                mockMvc.perform(
                                get("/api/v1/courses/{courseId}", activeCourseId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andReturn();
        // 필드는 빠지지 않고 null로 온다.
        tools.jackson.databind.JsonNode body =
                tools.jackson.databind.json.JsonMapper.builder()
                        .build()
                        .readTree(result.getResponse().getContentAsString());
        org.assertj.core.api.Assertions.assertThat(body.has("basemap")).isTrue();
        org.assertj.core.api.Assertions.assertThat(body.get("basemap").isNull()).isTrue();
    }

    @Test
    void C03_썸네일이_있으면_이미지_URL과_기준시각을_돌려주고_이미지가_없는_행은_null() throws Exception {
        String imageId = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
        jdbc.update(
                """
                INSERT INTO course_basemaps(course_id, image_key, osm_data_timestamp, render_version)
                VALUES (?, ?, '2026-10-20T00:00:00Z'::timestamptz, 'flat-v1')
                """,
                activeCourseId,
                "images/course-basemap/" + activeCourseId + "/" + imageId + ".png");
        // 범위 밖(OUT_OF_AREA)으로 저장된 행은 이미지가 없다.
        jdbc.update(
                "INSERT INTO course_basemaps(course_id, image_key, render_version) VALUES (?, NULL, 'flat-v1')",
                mergedCourseId);

        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.basemap.imageUrl").value("/api/v1/images/" + imageId))
                .andExpect(jsonPath("$.basemap.osmDataTimestamp").value("2026-10-20T00:00:00Z"))
                .andExpect(jsonPath("$.basemap.features").doesNotExist());

        MvcResult result =
                mockMvc.perform(
                                get("/api/v1/courses/{courseId}", mergedCourseId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andReturn();
        tools.jackson.databind.JsonNode body =
                tools.jackson.databind.json.JsonMapper.builder()
                        .build()
                        .readTree(result.getResponse().getContentAsString());
        org.assertj.core.api.Assertions.assertThat(body.has("basemap")).isTrue();
        org.assertj.core.api.Assertions.assertThat(body.get("basemap").isNull()).isTrue();
    }

    @Test
    void C03_썸네일_imageUrl은_F02로_PNG를_받고_참조되지_않은_키는_404() throws Exception {
        String imageId = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
        String imageKey = "images/course-basemap/" + activeCourseId + "/" + imageId + ".png";
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3};
        java.nio.file.Path file = IMAGE_VOLUME.resolve(imageKey);
        java.nio.file.Files.createDirectories(file.getParent());
        java.nio.file.Files.write(file, png);

        // 행이 참조하기 전에는 파일이 있어도 내주지 않는다.
        mockMvc.perform(get("/api/v1/images/{imageId}", imageId))
                .andExpect(status().isNotFound());

        jdbc.update(
                "INSERT INTO course_basemaps(course_id, image_key, render_version) VALUES (?, ?, 'flat-v1')",
                activeCourseId,
                imageKey);

        // 다른 이미지와 같이 토큰 없이도 조회된다(F02).
        mockMvc.perform(get("/api/v1/images/{imageId}", imageId))
                .andExpect(status().isOk())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                                .string("Content-Type", "image/png"))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                                .bytes(png))
                // 키가 그릴 때마다 새 UUID라 내용이 바뀌지 않으므로 오래 캐시한다(B-4).
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                                .string("Cache-Control", "public, max-age=31536000, immutable"));
        mockMvc.perform(
                        get("/api/v1/images/{imageId}", imageId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                                .string("Cache-Control", "public, max-age=31536000, immutable"));
    }

    @Test
    void C03_목표페이스면_estimatedDurationSec반환() throws Exception {
        // 5000m / 1000 * 360 sec/km = 1800
        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", activeCourseId)
                                .param("targetPaceSecPerKm", "360")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estimatedDurationSec").value(1800));
    }

    @Test
    void C03_북마크있으면_myAlias포함() throws Exception {
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"아침 루트"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.myAlias").value("아침 루트"));
    }

    @Test
    void C07_북마크생성멱등_별명갱신_null제거() throws Exception {
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"내 코스"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alias").value("내 코스"))
                .andExpect(jsonPath("$.bookmarked").value(true))
                .andExpect(jsonPath("$.createdAt").isNotEmpty());

        Integer countAfterFirst =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM course_bookmarks WHERE user_id=? AND course_id=?",
                        Integer.class,
                        userId,
                        activeCourseId);
        org.assertj.core.api.Assertions.assertThat(countAfterFirst).isEqualTo(1);

        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alias").value("내 코스"))
                .andExpect(jsonPath("$.bookmarked").value(true));

        Integer countAfterSecond =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM course_bookmarks WHERE user_id=? AND course_id=?",
                        Integer.class,
                        userId,
                        activeCourseId);
        org.assertj.core.api.Assertions.assertThat(countAfterSecond).isEqualTo(1);

        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"저녁 루트"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alias").value("저녁 루트"))
                .andExpect(jsonPath("$.bookmarked").value(true));

        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":null}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alias").value(nullValue()))
                .andExpect(jsonPath("$.bookmarked").value(true));

        String customName =
                jdbc.queryForObject(
                        "SELECT custom_name FROM course_bookmarks WHERE user_id=? AND course_id=?",
                        String.class,
                        userId,
                        activeCourseId);
        org.assertj.core.api.Assertions.assertThat(customName).isNull();
    }

    @Test
    void C08_해제멱등_bookmarkedfalse_코스행유지() throws Exception {
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"임시"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        delete("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(false));

        mockMvc.perform(
                        delete("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(false));

        Integer bookmarkCount =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM course_bookmarks WHERE user_id=? AND course_id=?",
                        Integer.class,
                        userId,
                        activeCourseId);
        org.assertj.core.api.Assertions.assertThat(bookmarkCount).isEqualTo(0);

        Integer courseCount =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM courses WHERE id=?", Integer.class, activeCourseId);
        org.assertj.core.api.Assertions.assertThat(courseCount).isEqualTo(1);
    }

    @Test
    void C09_북마크목록_myAlias_distanceM_커서페이지네이션() throws Exception {
        long courseA =
                insertCourse(DESC_PREFIX + " list-a", "ACTIVE", null, new BigDecimal("1000.00"));
        long courseB =
                insertCourse(DESC_PREFIX + " list-b", "ACTIVE", null, new BigDecimal("2000.00"));

        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", courseA)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"에이"}
                                        """))
                .andExpect(status().isOk());
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", courseB)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"비"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        get("/api/v1/users/me/bookmarked-courses")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value((int) courseB))
                .andExpect(jsonPath("$.items[0].myAlias").value("비"))
                .andExpect(jsonPath("$.items[0].distanceM").value(2000.0))
                .andExpect(jsonPath("$.items[0].status").value("ACTIVE"))
                // 공용 코스는 개인 코스가 아니다(S15P31E105-696).
                .andExpect(jsonPath("$.items[0].isPrivate").value(false))
                .andExpect(jsonPath("$.items[1].id").value((int) courseA))
                .andExpect(jsonPath("$.items[1].myAlias").value("에이"))
                .andExpect(jsonPath("$.items[1].distanceM").value(1000.0))
                .andExpect(jsonPath("$.items[1].isPrivate").value(false))
                .andExpect(jsonPath("$.page").doesNotExist());

        MvcResult firstPage =
                mockMvc.perform(
                                get("/api/v1/users/me/bookmarked-courses")
                                        .param("limit", "1")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value((int) courseB))
                        .andExpect(jsonPath("$.items[0].myAlias").value("비"))
                        .andExpect(jsonPath("$.page").isNotEmpty())
                        .andReturn();

        String pageCursor =
                firstPage
                        .getResponse()
                        .getContentAsString()
                        .replaceAll("(?s).*\"page\"\\s*:\\s*\"(\\d+)\".*", "$1");

        mockMvc.perform(
                        get("/api/v1/users/me/bookmarked-courses")
                                .param("limit", "1")
                                .param("cursor", pageCursor)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value((int) courseA))
                .andExpect(jsonPath("$.items[0].myAlias").value("에이"))
                .andExpect(jsonPath("$.items[0].distanceM").value(1000.0))
                // 커서 경로 SQL도 isPrivate를 내려준다(S15P31E105-696 리뷰 A-2·B-3).
                .andExpect(jsonPath("$.items[0].isPrivate").value(false))
                .andExpect(jsonPath("$.page").doesNotExist());
    }

    @Test
    void C07_C08_없는코스는_404_COURSE_NOT_FOUND() throws Exception {
        long missingId = 9_999_999L;
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", missingId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COURSE_NOT_FOUND"));
        mockMvc.perform(
                        delete("/api/v1/courses/{courseId}/bookmark", missingId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COURSE_NOT_FOUND"));
    }

    @Test
    void MERGED_코스도_저장하고_목록에_상태가_보인다() throws Exception {
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", mergedCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"병합별명"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(true));

        mockMvc.perform(
                        get("/api/v1/users/me/bookmarked-courses")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value((int) mergedCourseId))
                .andExpect(jsonPath("$.items[0].status").value("MERGED"))
                .andExpect(jsonPath("$.items[0].mergedIntoCourseId").isNumber())
                .andExpect(jsonPath("$.items[0].myAlias").value("병합별명"));
    }

    @Test
    void C09_잘못된_cursor는_400() throws Exception {
        mockMvc.perform(
                        get("/api/v1/users/me/bookmarked-courses")
                                .param("cursor", "abc")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 다른사용자_북마크별명은_상세에_노출되지_않는다() throws Exception {
        long otherId = insertUser("course_api_other", "다른유저", "01030001002");
        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(otherId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"alias":"남의별명"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", activeCourseId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.myAlias").value(nullValue()));
    }

    @Test
    void C01_스텁모드는_개발용_안내와_합성경사를_붙인_추천과_nextSeed를_반환한다() throws Exception {
        // DB에 ACTIVE 코스가 있어도 추천은 스텁 경로만 사용한다.
        RecordingRecommendPortConfig.TRANSACTION_ACTIVE.set(null);
        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 5.0,
                                          "shape": "loop",
                                          "filters": {"beach": true, "avoidMajorRoad": true},
                                          "seed": 1
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courses", hasSize(3)))
                .andExpect(jsonPath("$.nextSeed").value(25))
                .andExpect(jsonPath("$.courses[0].index").value(0))
                .andExpect(jsonPath("$.courses[0].distanceM").value(5000.0))
                .andExpect(jsonPath("$.courses[0].route.type").value("LineString"))
                .andExpect(jsonPath("$.courses[0].route.coordinates").isArray())
                .andExpect(jsonPath("$.courses[0].id").doesNotExist())
                .andExpect(jsonPath("$.courses[0].estimatedDurationSec").doesNotExist())
                .andExpect(jsonPath("$.courses[0].elevationProfile").isArray())
                .andExpect(jsonPath("$.courses[0].elevationProfile[0].gradePercent").isNumber())
                .andExpect(jsonPath("$.courses[0].summary").value(StubCourseRecommendAdapter.NOTICE))
                .andExpect(jsonPath("$.notices[0]").value(StubCourseRecommendAdapter.NOTICE));
        // Route 호출(최대 15초)은 DB 트랜잭션 밖에서 실행한다.
        org.assertj.core.api.Assertions.assertThat(RecordingRecommendPortConfig.TRANSACTION_ACTIVE.get())
                .isFalse();

        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 5.0,
                                          "seed": 25
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextSeed").value(49));
    }

    @Test
    void C01_거리_shape_도착_위도범위_위반은_422() throws Exception {
        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 21.2
                                        }
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 5.0,
                                          "shape": "triangle"
                                        }
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 5.0,
                                          "shape": "point_to_point"
                                        }
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 91.0,
                                          "longitude": 127.0,
                                          "distanceKm": 5.0
                                        }
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SEARCH"));

        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 5.0
                                        }
                                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void X_User_Id단독으로는_인증할수없다() throws Exception {
        mockMvc.perform(
                        get("/api/v1/courses/{courseId}", activeCourseId)
                                .header("X-User-Id", userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(
                        put("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("X-User-Id", userId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(
                        delete("/api/v1/courses/{courseId}/bookmark", activeCourseId)
                                .header("X-User-Id", userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(get("/api/v1/users/me/bookmarked-courses").header("X-User-Id", userId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(
                        post("/api/v1/courses/recommendations")
                                .header("X-User-Id", userId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "latitude": 35.1532,
                                          "longitude": 129.1186,
                                          "distanceKm": 5.0
                                        }
                                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    private long insertCourse(
            String description, String status, Long mergedIntoCourseId, BigDecimal distanceM) {
        return insertCourse(description, status, mergedIntoCourseId, distanceM, START_EWKT);
    }

    private long insertCourse(
            String description,
            String status,
            Long mergedIntoCourseId,
            BigDecimal distanceM,
            String startEwkt) {
        return jdbc.queryForObject(
                """
                INSERT INTO courses(description, route, start_position, distance, status, region_code, merged_into_course_id)
                VALUES (?, ST_GeogFromText(?), ST_GeogFromText(?), ?, ?::courses_status_enum, NULL, ?)
                RETURNING id
                """,
                Long.class,
                description,
                ROUTE_EWKT,
                startEwkt,
                distanceM,
                status,
                mergedIntoCourseId);
    }

    private void insertEnvironmentTag(long courseId, String environmentType) {
        jdbc.update(
                """
                INSERT INTO course_environment_tags(course_id, environment_type)
                VALUES (?, ?::course_environment_tags_environment_type_enum)
                """,
                courseId,
                environmentType);
    }
}
