package com.runway.backend.domain.runningrecord;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class RunningRecordApiIntegrationTest {

    private static final String LOGIN_PREFIX = "rr_api_";
    private static final String ROUTE_EWKT = "SRID=4326;LINESTRING(129 35, 129.001 35.001)";
    private static final String START_EWKT = "SRID=4326;POINT(129 35)";

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(RunningRecordApiIntegrationTest.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long ownerId;
    private long otherId;
    private long emptyUserId;
    private long courseId;
    private long completedA;
    private long completedB;
    private long completedGroup;
    private long runningSession;
    private long deletedSession;
    private long otherCompleted;
    private long detailSession;
    private long splitsSession;
    private long emptySplitsSession;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM running_session_splits");
        jdbc.update("DELETE FROM group_run_participants");
        jdbc.update("DELETE FROM group_runs");
        jdbc.update("DELETE FROM crew_memberships");
        jdbc.update("DELETE FROM crews WHERE name LIKE 'rr_api_%'");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM course_environment_tags");
        jdbc.update("DELETE FROM course_bookmarks");
        jdbc.update(
                "UPDATE courses SET merged_into_course_id = NULL WHERE description LIKE 'rr_api_%'");
        jdbc.update("DELETE FROM courses WHERE description LIKE 'rr_api_%'");
        jdbc.update("DELETE FROM users WHERE login_id LIKE ?", LOGIN_PREFIX + "%");

        ownerId = insertUser(LOGIN_PREFIX + "owner", "기록소유자", "01040001001");
        otherId = insertUser(LOGIN_PREFIX + "other", "타인", "01040001002");
        emptyUserId = insertUser(LOGIN_PREFIX + "empty", "빈유저", "01040001003");
        courseId = insertCourse("rr_api_ course");

        completedA =
                insertSession(
                        ownerId,
                        "COMPLETED",
                        courseId,
                        "2026-03-01T10:00:00Z",
                        new BigDecimal("5000.00"),
                        1500,
                        new BigDecimal("300.00"),
                        true,
                        null);
        completedB =
                insertSession(
                        ownerId,
                        "COMPLETED",
                        null,
                        "2026-03-02T10:00:00Z",
                        new BigDecimal("3000.00"),
                        1200,
                        new BigDecimal("400.00"),
                        false,
                        null);
        completedGroup =
                insertSession(
                        ownerId,
                        "COMPLETED",
                        null,
                        "2026-03-03T10:00:00Z",
                        new BigDecimal("8000.00"),
                        2400,
                        new BigDecimal("300.00"),
                        true,
                        null);
        linkGroupParticipant(ownerId, completedGroup);

        runningSession =
                insertSession(
                        ownerId,
                        "RUNNING",
                        null,
                        "2026-03-04T10:00:00Z",
                        null,
                        null,
                        null,
                        null,
                        null);
        deletedSession =
                insertSession(
                        ownerId,
                        "COMPLETED",
                        null,
                        "2026-02-01T10:00:00Z",
                        new BigDecimal("1000.00"),
                        400,
                        new BigDecimal("400.00"),
                        true,
                        "2026-03-10T00:00:00Z");
        otherCompleted =
                insertSession(
                        otherId,
                        "COMPLETED",
                        null,
                        "2026-03-05T10:00:00Z",
                        new BigDecimal("7000.00"),
                        2100,
                        new BigDecimal("300.00"),
                        true,
                        null);

        detailSession =
                insertFullDetailSession(
                        ownerId,
                        courseId,
                        completedA,
                        "2026-03-06T08:00:00Z",
                        5000,
                        1800,
                        new BigDecimal("360.00"),
                        new BigDecimal("5120.50"),
                        1700,
                        1800,
                        new BigDecimal("332.50"),
                        new BigDecimal("145.00"),
                        new BigDecimal("170.00"),
                        true);

        splitsSession =
                insertSession(
                        ownerId,
                        "COMPLETED",
                        null,
                        "2026-03-07T09:00:00Z",
                        new BigDecimal("2500.00"),
                        900,
                        new BigDecimal("360.00"),
                        true,
                        null);
        insertSplit(splitsSession, "0", "1000", "350.00", "140.00", "165.00");
        insertSplit(splitsSession, "1000", "2000", "370.00", null, "168.00");
        insertSplit(splitsSession, "2000", "2500", "390.00", "150.00", null);

        emptySplitsSession =
                insertSession(
                        ownerId,
                        "COMPLETED",
                        null,
                        "2026-03-08T09:00:00Z",
                        new BigDecimal("1000.00"),
                        400,
                        new BigDecimal("400.00"),
                        null,
                        null);
    }

    @Test
    void H01_본인_COMPLETED_미삭제만_목록_빈목록_401() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(6)))
                .andExpect(jsonPath("$.items[0].id").value(emptySplitsSession))
                .andExpect(jsonPath("$.page").doesNotExist());

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .header("Authorization", SecurityTestSupport.bearer(emptyUserId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)))
                .andExpect(jsonPath("$.page").doesNotExist());

        mockMvc.perform(get("/api/v1/running-records"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void H01_필터_정렬_limit_잘못된조건() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("runType", "SOLO")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(5)));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("runType", "GROUP")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(completedGroup));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("courseId", String.valueOf(courseId))
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("from", "2026-03-02T00:00:00Z")
                                .param("to", "2026-03-04T00:00:00Z")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].id").value(completedGroup))
                .andExpect(jsonPath("$.items[1].id").value(completedB));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("sort", "DISTANCE")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(completedGroup))
                .andExpect(jsonPath("$.items[0].totalDistance").value(8000.0));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("sort", "PACE")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].averagePace").value(300.0));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("limit", "2")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.page").isNotEmpty());

        MvcResult page1 =
                mockMvc.perform(
                                get("/api/v1/running-records")
                                        .param("limit", "2")
                                        .param("sort", "LATEST")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(ownerId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items", hasSize(2)))
                        .andReturn();
        String nextPage = JsonPath.read(page1.getResponse().getContentAsString(), "$.page");

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("limit", "2")
                                .param("sort", "LATEST")
                                .param("cursor", nextPage)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("runType", "TEAM")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("sort", "SPEED")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("limit", "0")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("limit", "51")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("from", "not-an-instant")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        String badCursor =
                Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString("broken".getBytes(StandardCharsets.UTF_8));
        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("cursor", badCursor)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("from", "2026-03-04T00:00:00Z")
                                .param("to", "2026-03-04T00:00:00Z")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));

        MvcResult distancePage1 =
                mockMvc.perform(
                                get("/api/v1/running-records")
                                        .param("limit", "2")
                                        .param("sort", "DISTANCE")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(ownerId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items", hasSize(2)))
                        .andExpect(jsonPath("$.items[0].id").value(completedGroup))
                        .andExpect(jsonPath("$.page").isNotEmpty())
                        .andReturn();
        String distanceCursor =
                JsonPath.read(distancePage1.getResponse().getContentAsString(), "$.page");
        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("limit", "2")
                                .param("sort", "DISTANCE")
                                .param("cursor", distanceCursor)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].id").value(completedA));
    }

    @Test
    void H02_필드매핑과_인가() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}", detailSession)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(detailSession))
                .andExpect(jsonPath("$.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.targetDurationSec").value(1800))
                .andExpect(jsonPath("$.actualDistanceM").value(5120.50))
                .andExpect(jsonPath("$.movingDurationSec").value(1700))
                .andExpect(jsonPath("$.elapsedDurationSec").value(1800))
                .andExpect(jsonPath("$.averagePaceSecPerKm").value(332.50))
                .andExpect(jsonPath("$.averageHeartRate").value(145.0))
                .andExpect(jsonPath("$.averageCadence").value(170.0))
                .andExpect(jsonPath("$.goalAchieved").value(true))
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.targetPaceSecPerKm").value(360.0))
                .andExpect(jsonPath("$.comparisonSessionId").value(completedA))
                .andExpect(jsonPath("$.routePreviewImageUrl").doesNotExist());

        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}", otherCompleted)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));

        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}", deletedSession)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));

        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}", 9_999_999L)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));

        mockMvc.perform(get("/api/v1/running-records/{sessionId}", detailSession))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void H03_구간정렬_빈배열_인가() throws Exception {
        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}/splits", splitsSession)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.splits", hasSize(3)))
                .andExpect(jsonPath("$.splits[0].startDistanceM").value(0))
                .andExpect(jsonPath("$.splits[0].endDistanceM").value(1000))
                .andExpect(jsonPath("$.splits[0].paceSecPerKm").value(350.0))
                .andExpect(jsonPath("$.splits[0].averageHeartRate").value(140.0))
                .andExpect(jsonPath("$.splits[0].averageCadence").value(165.0))
                .andExpect(jsonPath("$.splits[1].startDistanceM").value(1000))
                .andExpect(jsonPath("$.splits[1].averageHeartRate").value(nullValue()))
                .andExpect(jsonPath("$.splits[1].averageCadence").value(168.0))
                .andExpect(jsonPath("$.splits[2].startDistanceM").value(2000))
                .andExpect(jsonPath("$.splits[2].endDistanceM").value(2500))
                .andExpect(jsonPath("$.splits[2].averageHeartRate").value(150.0))
                .andExpect(jsonPath("$.splits[2].averageCadence").value(nullValue()));

        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}/splits", emptySplitsSession)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.splits", hasSize(0)));

        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}/splits", otherCompleted)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));

        mockMvc.perform(
                        get("/api/v1/running-records/{sessionId}/splits", deletedSession)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));

        mockMvc.perform(get("/api/v1/running-records/{sessionId}/splits", splitsSession))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
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

    private long insertCourse(String description) {
        return jdbc.queryForObject(
                """
                INSERT INTO courses(description, route, start_position, distance, status)
                VALUES (?, ST_GeogFromText(?), ST_GeogFromText(?), ?, 'ACTIVE'::courses_status_enum)
                RETURNING id
                """,
                Long.class,
                description,
                ROUTE_EWKT,
                START_EWKT,
                new BigDecimal("5000.00"));
    }

    private long insertSession(
            long userId,
            String status,
            Long courseId,
            String startedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace,
            Boolean goalAchieved,
            String deletedAt) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(
                  user_id, course_id, status, started_at, ended_at,
                  total_distance, moving_duration, elapsed_duration,
                  average_pace, goal_achieved, deleted_at)
                VALUES (
                  ?, ?, ?::running_sessions_status_enum, ?::timestamptz,
                  CASE WHEN ? = 'COMPLETED' THEN ?::timestamptz + interval '1 hour' ELSE NULL END,
                  ?, ?, ?, ?, ?, ?::timestamptz)
                RETURNING id
                """,
                Long.class,
                userId,
                courseId,
                status,
                startedAt,
                status,
                startedAt,
                totalDistance,
                movingDuration,
                movingDuration,
                averagePace,
                goalAchieved,
                deletedAt);
    }

    private long insertFullDetailSession(
            long userId,
            long courseId,
            long comparisonSessionId,
            String startedAt,
            int goalDistance,
            int goalDuration,
            BigDecimal goalPace,
            BigDecimal totalDistance,
            int movingDuration,
            int elapsedDuration,
            BigDecimal averagePace,
            BigDecimal averageHeartRate,
            BigDecimal averageCadence,
            boolean goalAchieved) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(
                  user_id, course_id, comparison_session_id, status,
                  goal_distance, goal_duration, goal_pace,
                  started_at, ended_at,
                  total_distance, moving_duration, elapsed_duration,
                  average_pace, average_heart_rate, average_cadence, goal_achieved)
                VALUES (
                  ?, ?, ?, 'COMPLETED'::running_sessions_status_enum,
                  ?, ?, ?,
                  ?::timestamptz, ?::timestamptz + interval '1 hour',
                  ?, ?, ?,
                  ?, ?, ?, ?)
                RETURNING id
                """,
                Long.class,
                userId,
                courseId,
                comparisonSessionId,
                goalDistance,
                goalDuration,
                goalPace,
                startedAt,
                startedAt,
                totalDistance,
                movingDuration,
                elapsedDuration,
                averagePace,
                averageHeartRate,
                averageCadence,
                goalAchieved);
    }

    private void insertSplit(
            long sessionId,
            String startDistance,
            String endDistance,
            String pace,
            String averageHeartRate,
            String averageCadence) {
        jdbc.update(
                """
                INSERT INTO running_session_splits(
                  running_session_id, start_distance, end_distance, pace,
                  average_heart_rate, average_cadence)
                VALUES (?, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric)
                """,
                sessionId,
                startDistance,
                endDistance,
                pace,
                averageHeartRate,
                averageCadence);
    }

    private void linkGroupParticipant(long userId, long sessionId) {
        long crewId =
                jdbc.queryForObject(
                        """
                        INSERT INTO crews(owner_id, name, capacity)
                        VALUES (?, 'rr_api_crew', 10)
                        RETURNING id
                        """,
                        Long.class,
                        userId);
        long groupRunId =
                jdbc.queryForObject(
                        """
                        INSERT INTO group_runs(crew_id, host_id, title, scheduled_at)
                        VALUES (?, ?, 'rr_api_group', now())
                        RETURNING id
                        """,
                        Long.class,
                        crewId,
                        userId);
        jdbc.update(
                """
                INSERT INTO group_run_participants(group_run_id, user_id, session_id)
                VALUES (?, ?, ?)
                """,
                groupRunId,
                userId,
                sessionId);
    }
}
