package com.runway.backend.domain.session;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.runway.backend.domain.coaching.decide.FakePaceDecider;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 세션 API 통합 테스트 공통 준비. 모든 값은 합성 데이터이며 실제 건강·GPS 정보를 쓰지 않는다.
 *
 * <p>하위 테스트 클래스들이 Spring 컨텍스트와 공유 서버({@link SharedPostgres})의 전용 DB를 함께 쓴다. 서버는 JVM 종료 시
 * Testcontainers가 정리한다. 클래스마다 내렸다 올리면 캐시된 컨텍스트가 닫힌 포트를 가리킨다.
 *
 * <p>웹 환경과 {@link EndedEventRecorder}를 여기서 정해 하위 클래스가 컨텍스트 하나를 함께 쓴다. 기록기는 쓰는 테스트가 매번 비운다. 동작을 대체하는
 * Mock이나 다른 속성이 필요한 테스트만 자기 구성을 선언한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Import({FakePaceDecider.Config.class, FakePersonalPacePlan.Config.class, EndedEventRecorder.class})
abstract class RunningSessionIntegrationSupport {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(RunningSessionIntegrationSupport.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired protected MockMvc mockMvc;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected FakePaceDecider paceDecider;
    @Autowired protected FakePersonalPacePlan personalPlan;

    protected long userId;
    protected long otherUserId;
    protected long watchId;
    protected long phoneId;
    protected long otherWatchId;
    protected long otherPhoneId;
    private int seq;

    @BeforeEach
    void resetData() {
        paceDecider.reset();
        personalPlan.reset();
        jdbc.update("DELETE FROM posts");
        jdbc.update("DELETE FROM running_metric_samples");
        jdbc.update("DELETE FROM session_control_events");
        jdbc.update("DELETE FROM coaching_decisions");
        jdbc.update("DELETE FROM pace_plan_segments");
        jdbc.update("DELETE FROM pace_plans");
        jdbc.update("DELETE FROM group_run_participants");
        jdbc.update("DELETE FROM group_runs");
        jdbc.update("DELETE FROM crews");
        // One DELETE removes both ends of the self-FK; do not mutate retired owners during cleanup.
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM courses");
        jdbc.update("DELETE FROM user_devices");
        jdbc.update("DELETE FROM users");
        userId = insertUser("AGREEE");
        otherUserId = insertUser("AGREEE");
        watchId = insertDevice(userId, "WATCH", false);
        phoneId = insertDevice(userId, "PHONE", false);
        otherWatchId = insertDevice(otherUserId, "WATCH", false);
        otherPhoneId = insertDevice(otherUserId, "PHONE", false);
    }

    protected long insertUser(String healthDataAccess) {
        int n = seq++;
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?,'hash',?,'2000-01-01','MALE','01011112222',?::users_health_data_access_enum)
                RETURNING id
                """,
                Long.class,
                "session_user" + n,
                "러너" + n,
                healthDataAccess);
    }

    protected long insertDevice(long owner, String type, boolean unlinked) {
        return jdbc.queryForObject(
                "INSERT INTO user_devices(user_id,device_type,linked_at,unlinked_at)"
                        + " VALUES (?,?::user_devices_device_type_enum,now(),"
                        + (unlinked ? "now()" : "NULL")
                        + ") RETURNING id",
                Long.class,
                owner,
                type);
    }

    /** 합성 코스. 경로는 서울 근처의 임의 좌표다. */
    protected long insertCourse(String status, String distanceM) {
        return jdbc.queryForObject(
                """
                INSERT INTO courses(route,start_position,distance,status)
                VALUES (ST_GeogFromText('LINESTRING(127.0 37.5, 127.01 37.51)'),
                        ST_GeogFromText('POINT(127.0 37.5)'), ?::numeric, ?::courses_status_enum)
                RETURNING id
                """,
                Long.class,
                distanceM,
                status);
    }

    protected long insertSession(
            long owner,
            String status,
            long version,
            Long control,
            Long relay,
            String analysis,
            Long courseId) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id,status,state_version,control_device_id,relay_device_id,
                                             analysis_status,course_id,started_at)
                VALUES (?,?::running_sessions_status_enum,?,?,?,?::running_sessions_analysis_status_enum,?,
                        CASE WHEN ?::text IN ('RUNNING','PAUSED','COMPLETED') THEN now() END)
                RETURNING id
                """,
                Long.class,
                owner,
                status,
                version,
                control,
                relay,
                analysis,
                courseId,
                status);
    }

    protected long insertReadySession() {
        return insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", null);
    }

    protected long insertCommand(
            long sessionId, long deviceId, String action, long expectedVersion, String result) {
        return jdbc.queryForObject(
                """
                INSERT INTO session_control_events(session_id,device_id,action,target_bpm,expected_version,result,applied_at)
                VALUES (?,?,?::session_control_events_action_enum,
                        CASE WHEN ?::text = 'SET_BPM' THEN 160 END,?,
                        ?::session_control_events_result_enum,
                        CASE WHEN ?::text = 'APPLIED' THEN now() END)
                RETURNING id
                """,
                Long.class,
                sessionId,
                deviceId,
                action,
                action,
                expectedVersion,
                result,
                result);
    }

    protected long insertGroupRun(String status, boolean ended) {
        long crewId =
                jdbc.queryForObject(
                        "INSERT INTO crews(owner_id,name,capacity) VALUES (?,'크루',10) RETURNING id",
                        Long.class,
                        userId);
        return jdbc.queryForObject(
                """
                INSERT INTO group_runs(crew_id,host_id,title,scheduled_at,status,ended_at)
                VALUES (?,?,'그룹런',now(),?::group_runs_status_enum,
                        CASE WHEN ? THEN TIMESTAMPTZ '2026-10-29T01:00:00Z' END)
                RETURNING id
                """,
                Long.class,
                crewId,
                userId,
                status,
                ended);
    }

    protected void joinGroup(long groupRunId, long owner, long sessionId) {
        jdbc.update(
                "INSERT INTO group_run_participants(group_run_id,user_id,session_id) VALUES"
                        + " (?,?,?)",
                groupRunId,
                owner,
                sessionId);
    }

    protected long insertPost(long author, long sessionId, boolean deleted) {
        return jdbc.queryForObject(
                "INSERT INTO posts(author_id,session_id,body,deleted_at) VALUES (?,?,'공유',"
                        + (deleted ? "TIMESTAMPTZ '2026-01-01T00:00:00Z'" : "NULL")
                        + ") RETURNING id",
                Long.class,
                author,
                sessionId);
    }

    protected long stateVersion(long sessionId) {
        return jdbc.queryForObject(
                "SELECT state_version FROM running_sessions WHERE id=?", Long.class, sessionId);
    }

    protected int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    protected MockHttpServletRequestBuilder createRequest(long user, String body) {
        return post("/api/v1/running-sessions")
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    protected MockHttpServletRequestBuilder getRequest(long user, Object sessionId) {
        return get("/api/v1/running-sessions/" + sessionId)
                .header("Authorization", SecurityTestSupport.bearer(user));
    }

    protected MockHttpServletRequestBuilder patchRequest(long user, Object sessionId, String body) {
        return patch("/api/v1/running-sessions/" + sessionId)
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    protected MockHttpServletRequestBuilder deleteRequest(long user, Object sessionId) {
        return delete("/api/v1/running-sessions/" + sessionId)
                .header("Authorization", SecurityTestSupport.bearer(user));
    }

    /** S03~S06. path는 start·pause·resume·finish. */
    protected MockHttpServletRequestBuilder postControl(
            long user, Object sessionId, String path, String body) {
        return post("/api/v1/running-sessions/" + sessionId + "/" + path)
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    /** S07. 본문이 없다. */
    protected MockHttpServletRequestBuilder cancelRequest(long user, Object sessionId) {
        return post("/api/v1/running-sessions/" + sessionId + "/cancel")
                .header("Authorization", SecurityTestSupport.bearer(user));
    }

    protected String requestBody(long deviceId, long expectedVersion) {
        return "{\"phase\":\"REQUEST\",\"deviceId\":"
                + deviceId
                + ",\"expectedVersion\":"
                + expectedVersion
                + "}";
    }

    /** appliedAt은 APPLIED일 때만 따옴표로 감싼 값, 그 밖에는 null. */
    protected String resultBody(long commandId, long deviceId, String result, String appliedAt) {
        return "{\"phase\":\"RESULT\",\"commandId\":"
                + commandId
                + ",\"deviceId\":"
                + deviceId
                + ",\"result\":\""
                + result
                + "\",\"appliedAt\":"
                + (appliedAt == null ? "null" : "\"" + appliedAt + "\"")
                + ",\"reasonCode\":null}";
    }

    /** P07. */
    protected MockHttpServletRequestBuilder putBpm(long user, Object sessionId, String body) {
        return put("/api/v1/running-sessions/" + sessionId + "/bpm")
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    protected String bpmRequestBody(long deviceId, long expectedVersion, Object targetBpm) {
        return "{\"phase\":\"REQUEST\",\"operation\":\"SET_BPM\",\"deviceId\":"
                + deviceId
                + ",\"expectedVersion\":"
                + expectedVersion
                + ",\"targetBpm\":"
                + targetBpm
                + ",\"coachingId\":null}";
    }

    /** 실제 시작시각을 과거로 옮긴다(코칭 2분 기준 확인용). */
    protected void startedSecondsAgo(long sessionId, long seconds) {
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - make_interval(secs => ?) WHERE"
                        + " id=?",
                (double) seconds,
                sessionId);
        insertFreshSamples(sessionId, seconds);
    }

    /** AI04 입력용 합성 측정 표본. 최근 25초 동안 5초마다 심박 150·속도 2.5m/s(기준 페이스 400초/km)를 넣는다. 마지막 표본은 지금 측정됐다. */
    protected void insertFreshSamples(long sessionId, long elapsedSec) {
        for (int i = 5; i >= 0; i--) {
            long elapsed = Math.max(0, elapsedSec - i * 5L);
            jdbc.update(
                    """
                    INSERT INTO running_metric_samples(running_session_id,measured_at,elapsed_duration,heart_rate,
                                                       speed,total_distance,is_hr_measured)
                    VALUES (?, now() - make_interval(secs => ?), ?, 150, 2.5, ?, true)
                    """,
                    sessionId,
                    (double) (i * 5),
                    elapsed,
                    elapsed * 2.5);
        }
    }

    /** 합성 코칭 추천과 COACHING 명령. 만료는 생성 후 20초. */
    protected long[] insertCoaching(
            long sessionId, long deviceId, long version, int bpm, String result, boolean expired) {
        long coachingId =
                jdbc.queryForObject(
                        """
                        INSERT INTO coaching_decisions(session_id,elapsed_duration,recommended_pace,cue_bpm,
                                                       based_on_state_version,expires_at,created_at)
                        VALUES (?,60,360.00,?,?,
                                CASE WHEN ? THEN now() - interval '10 seconds' ELSE now() + interval '19 seconds' END,
                                CASE WHEN ? THEN now() - interval '30 seconds' ELSE now() END)
                        RETURNING id
                        """,
                        Long.class,
                        sessionId,
                        bpm,
                        version,
                        expired,
                        expired);
        long commandId =
                jdbc.queryForObject(
                        """
                        INSERT INTO session_control_events(session_id,device_id,action,target_bpm,expected_version,
                                                           coaching_id,result,applied_at)
                        VALUES (?,?,'COACHING',?,?,?,?::session_control_events_result_enum,
                                CASE WHEN ?::text = 'APPLIED' THEN now() END)
                        RETURNING id
                        """,
                        Long.class,
                        sessionId,
                        deviceId,
                        bpm,
                        version,
                        coachingId,
                        result,
                        result);
        return new long[] {coachingId, commandId};
    }

    protected Integer currentBpm(long sessionId) {
        return jdbc.queryForObject(
                "SELECT current_bpm FROM running_sessions WHERE id=?", Integer.class, sessionId);
    }

    protected int commandCount(long sessionId) {
        return count("SELECT count(*) FROM session_control_events WHERE session_id=?", sessionId);
    }

    protected String sessionStatus(long sessionId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM running_sessions WHERE id=?", String.class, sessionId);
    }

    protected String devices() {
        return "\"controlDeviceId\":" + watchId + ",\"relayDeviceId\":" + phoneId;
    }
}
