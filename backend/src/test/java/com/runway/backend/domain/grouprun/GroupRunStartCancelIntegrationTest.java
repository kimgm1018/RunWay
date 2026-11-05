package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.util.List;
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
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-261 slice 2. G13 그룹런 취소와 G09 그룹런 시작 승인. */
@SpringBootTest
@AutoConfigureMockMvc
class GroupRunStartCancelIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(GroupRunStartCancelIntegrationTest.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper mapper;

    private long hostId;
    private long memberId;
    private long outsiderId;
    private long crewId;
    private long hostWatchId;
    private long memberWatchId;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM pace_plan_segments");
        jdbc.update("DELETE FROM pace_plans");
        jdbc.update("DELETE FROM session_control_events");
        jdbc.update("DELETE FROM group_run_participants");
        jdbc.update("DELETE FROM group_runs");
        jdbc.update("DELETE FROM crew_memberships");
        jdbc.update("DELETE FROM crews");
        jdbc.update("UPDATE running_sessions SET comparison_session_id = NULL");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM user_devices");
        jdbc.update("DELETE FROM users");

        hostId = insertUser("gr_sc_host", "호스트", "01033330001");
        memberId = insertUser("gr_sc_member", "멤버", "01033330002");
        outsiderId = insertUser("gr_sc_out", "외부인", "01033330003");
        hostWatchId = insertDevice(hostId, "WATCH");
        insertDevice(hostId, "PHONE");
        memberWatchId = insertDevice(memberId, "WATCH");
        insertDevice(memberId, "PHONE");
        crewId = insertCrew(hostId, "시작취소 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberId);
    }

    // ---------------------------------------------------------------- G13

    @Test
    void cancel_hostSucceeds_storesReason_cancelsReadySessions_keepsSessionLinks()
            throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);

        cancel(groupRunId, hostId, "{\"cancelReason\":\"WEATHER\",\"cancelMessage\":\"비가 와요\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        assertThat(groupStatus(groupRunId)).isEqualTo("CANCELLED");
        assertThat(cancelReason(groupRunId)).isEqualTo("WEATHER");
        assertThat(sessionStatus(hostSession)).isEqualTo("CANCELLED");
        assertThat(sessionStatus(memberSession)).isEqualTo("CANCELLED");
        assertThat(participantSessionId(groupRunId, hostId)).isEqualTo(hostSession);
        assertThat(participantSessionId(groupRunId, memberId)).isEqualTo(memberSession);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM session_control_events",
                                Integer.class))
                .isZero();
    }

    @Test
    void cancel_nonHost_forbidden_andNothingChanges() throws Exception {
        long groupRunId = createGroupRun();
        long memberSession = joinAndReady(groupRunId, memberId);

        cancel(groupRunId, memberId, "{\"cancelReason\":\"WEATHER\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(cancelReason(groupRunId)).isNull();
        assertThat(sessionStatus(memberSession)).isEqualTo("READY");
    }

    @Test
    void cancel_missingGroup_notFound() throws Exception {
        cancel(9_999_999L, hostId, "{\"cancelReason\":\"WEATHER\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    void cancel_repeated_isIdempotent_andKeepsFirstReason() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);

        cancel(groupRunId, hostId, "{\"cancelReason\":\"WEATHER\"}").andExpect(status().isOk());
        long versionAfterFirst = sessionVersion(hostSession);

        cancel(groupRunId, hostId, "{\"cancelReason\":\"PERSONAL\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        assertThat(cancelReason(groupRunId)).isEqualTo("WEATHER");
        assertThat(sessionVersion(hostSession)).isEqualTo(versionAfterFirst);
    }

    @Test
    void cancel_invalidInput_badRequest() throws Exception {
        long groupRunId = createGroupRun();

        cancel(groupRunId, hostId, "{\"cancelReason\":\"BORED\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        cancel(groupRunId, hostId, "{}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        cancel(
                        groupRunId,
                        hostId,
                        "{\"cancelReason\":\"OTHER\",\"cancelMessage\":\"" + "가".repeat(101) + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(cancelReason(groupRunId)).isNull();
    }

    @Test
    void cancel_maxLengthMessageAndEveryReason_accepted() throws Exception {
        for (String reason :
                List.of("WEATHER", "PERSONAL", "LACK_OF_PARTICIPANTS", "LOCATION_ISSUE", "OTHER")) {
            long groupRunId = createGroupRun();
            cancel(
                            groupRunId,
                            hostId,
                            "{\"cancelReason\":\""
                                    + reason
                                    + "\",\"cancelMessage\":\""
                                    + "가".repeat(100)
                                    + "\"}")
                    .andExpect(status().isOk());
            assertThat(cancelReason(groupRunId)).isEqualTo(reason);
        }
    }

    @Test
    void cancel_afterStart_conflict() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());

        cancel(groupRunId, hostId, "{\"cancelReason\":\"WEATHER\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
    }

    // ---------------------------------------------------------------- G09

    @Test
    void start_hostApprovesPendingStartCommands_andGroupRuns() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);

        start(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants", hasSize(2)))
                .andExpect(jsonPath("$.participants[0].sessionId").value(hostSession))
                .andExpect(jsonPath("$.participants[0].result").value("PENDING"))
                .andExpect(jsonPath("$.participants[0].expectedVersion").value(1))
                .andExpect(jsonPath("$.participants[0].startedAt").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].sessionId").value(memberSession))
                .andExpect(jsonPath("$.participants[1].result").value("PENDING"))
                .andExpect(jsonPath("$.participants[1].expectedVersion").value(1))
                .andExpect(jsonPath("$.participants[1].startedAt").value(nullValue()));

        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(startEventCount(hostSession)).isEqualTo(1);
        assertThat(startEventCount(memberSession)).isEqualTo(1);
        assertThat(startEventDeviceId(hostSession)).isEqualTo(hostWatchId);
        assertThat(startEventDeviceId(memberSession)).isEqualTo(memberWatchId);
        assertThat(startEventResult(hostSession)).isEqualTo("PENDING");
        assertThat(startEventExpectedVersion(memberSession)).isEqualTo(1L);
        // 승인은 세션 상태를 바꾸지 않고, 참가 관계 연결을 보존한다.
        assertThat(sessionStatus(hostSession)).isEqualTo("READY");
        assertThat(participantSessionId(groupRunId, memberId)).isEqualTo(memberSession);
    }

    @Test
    void start_nonHost_forbidden_andNothingCreated() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);

        start(groupRunId, memberId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));
        start(groupRunId, outsiderId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(startEventCount(hostSession)).isZero();
    }

    @Test
    void start_missingGroup_notFound() throws Exception {
        start(9_999_999L, hostId)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    void start_withRequestBody_badRequest() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/start", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
    }

    @Test
    void start_withoutReadySessions_conflict_andDoesNotAutoCreateSessions() throws Exception {
        long groupRunId = createGroupRun();
        joinOnly(groupRunId, memberId);

        start(groupRunId, hostId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM running_sessions", Integer.class))
                .isZero();
        assertThat(participantSessionId(groupRunId, hostId)).isNull();
    }

    @Test
    void start_repeated_returnsSameCommands_withoutNewEvents() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);

        JsonNode first = body(start(groupRunId, hostId).andExpect(status().isOk()).andReturn());
        JsonNode second = body(start(groupRunId, hostId).andExpect(status().isOk()).andReturn());

        assertThat(second.get("participants")).hasSize(2);
        for (int i = 0; i < 2; i++) {
            assertThat(second.get("participants").get(i).get("commandId").asLong())
                    .isEqualTo(first.get("participants").get(i).get("commandId").asLong());
            assertThat(second.get("participants").get(i).get("sessionId").asLong())
                    .isEqualTo(first.get("participants").get(i).get("sessionId").asLong());
            assertThat(second.get("participants").get(i).get("expectedVersion").asLong())
                    .isEqualTo(first.get("participants").get(i).get("expectedVersion").asLong());
            assertThat(second.get("participants").get(i).get("result").asString())
                    .isEqualTo("PENDING");
        }
        assertThat(startEventCount(hostSession)).isEqualTo(1);
        assertThat(startEventCount(memberSession)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM session_control_events", Integer.class))
                .isEqualTo(2);

        // 재요청은 호스트만 확인할 수 있다.
        start(groupRunId, memberId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));
    }

    @Test
    void start_repeated_reflectsCurrentResult() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        JsonNode first = body(start(groupRunId, hostId).andExpect(status().isOk()).andReturn());
        long commandId = first.get("participants").get(0).get("commandId").asLong();

        jdbc.update(
                "UPDATE session_control_events SET result = 'REJECTED'::session_control_events_result_enum WHERE id = ?",
                commandId);

        start(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].commandId").value(commandId))
                .andExpect(jsonPath("$.participants[0].sessionId").value(hostSession))
                .andExpect(jsonPath("$.participants[0].result").value("REJECTED"));
    }

    @Test
    void start_afterCancel_conflict() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);
        cancel(groupRunId, hostId, "{\"cancelReason\":\"LOCATION_ISSUE\"}")
                .andExpect(status().isOk());

        start(groupRunId, hostId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));

        assertThat(groupStatus(groupRunId)).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM session_control_events", Integer.class))
                .isZero();
    }

    @Test
    void start_cancelledLinkedSession_isExcluded_othersStart() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        jdbc.update(
                "UPDATE running_sessions SET status = 'CANCELLED'::running_sessions_status_enum WHERE id = ?",
                memberSession);

        start(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants", hasSize(1)))
                .andExpect(jsonPath("$.participants[0].sessionId").value(hostSession));

        assertThat(startEventCount(memberSession)).isZero();
        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
    }

    @Test
    void start_oneTargetInvalid_rollsBackEverything() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        // 호스트(낮은 세션 ID)는 먼저 승인되지만 멤버 세션이 이미 RUNNING이라 전체가 롤백돼야 한다.
        jdbc.update(
                "UPDATE running_sessions SET status = 'RUNNING'::running_sessions_status_enum WHERE id = ?",
                memberSession);

        start(groupRunId, hostId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(startEventCount(hostSession)).isZero();
        assertThat(startEventCount(memberSession)).isZero();
    }

    @Test
    void start_memberWithoutWatchAsControlDevice_forbidden_andRollsBack() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        jdbc.update(
                "UPDATE user_devices SET unlinked_at = now() WHERE id = ?", memberWatchId);

        start(groupRunId, hostId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(startEventCount(hostSession)).isZero();
        assertThat(startEventCount(memberSession)).isZero();
    }

    @Test
    void start_goalChangedAfterReady_conflict() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        jdbc.update("UPDATE group_runs SET goal_distance = 7000 WHERE id = ?", groupRunId);

        start(groupRunId, hostId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        assertThat(groupStatus(groupRunId)).isEqualTo("SCHEDULED");
        assertThat(startEventCount(hostSession)).isZero();
    }

    // ---------------------------------------------------------------- helpers

    private org.springframework.test.web.servlet.ResultActions cancel(
            long groupRunId, long userId, String json) throws Exception {
        return mockMvc.perform(
                post("/api/v1/group-runs/{id}/cancel", groupRunId)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json));
    }

    private org.springframework.test.web.servlet.ResultActions start(long groupRunId, long userId)
            throws Exception {
        return mockMvc.perform(
                post("/api/v1/group-runs/{id}/start", groupRunId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private JsonNode body(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private long readyHost(long groupRunId) throws Exception {
        return ready(groupRunId, hostId);
    }

    private void joinOnly(long groupRunId, long userId) throws Exception {
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk());
    }

    private long joinAndReady(long groupRunId, long userId) throws Exception {
        joinOnly(groupRunId, userId);
        return ready(groupRunId, userId);
    }

    private long ready(long groupRunId, long userId) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(userId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"ready\":true}"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.sessionId").isNumber())
                        .andReturn();
        return body(result).get("sessionId").asLong();
    }

    private long createGroupRun() throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/group-runs")
                                        .header("Authorization", SecurityTestSupport.bearer(hostId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(createBody(crewId)))
                        .andExpect(status().isCreated())
                        .andReturn();
        return body(created).get("id").asLong();
    }

    private static String createBody(long crewId) {
        return """
                {
                  "title":"시작취소 그룹런",
                  "crewId":%d,
                  "scheduledAt":"2030-01-15T01:00:00Z",
                  "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                  "meetingPlaceName":"집결지",
                  "meetingAddress":"부산",
                  "targetDistanceM":5000,
                  "goalInputType":"TIME",
                  "targetDurationSec":1800
                }
                """
                .formatted(crewId);
    }

    private String groupStatus(long groupRunId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM group_runs WHERE id=?", String.class, groupRunId);
    }

    private String cancelReason(long groupRunId) {
        return jdbc.queryForObject(
                "SELECT cancel_reason FROM group_runs WHERE id=?", String.class, groupRunId);
    }

    private String sessionStatus(long sessionId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM running_sessions WHERE id=?", String.class, sessionId);
    }

    private long sessionVersion(long sessionId) {
        return jdbc.queryForObject(
                "SELECT state_version FROM running_sessions WHERE id=?", Long.class, sessionId);
    }

    private int startEventCount(long sessionId) {
        return jdbc.queryForObject(
                """
                SELECT count(*) FROM session_control_events
                WHERE session_id=? AND action='START'::session_control_events_action_enum
                """,
                Integer.class,
                sessionId);
    }

    private long startEventDeviceId(long sessionId) {
        return jdbc.queryForObject(
                "SELECT device_id FROM session_control_events WHERE session_id=?",
                Long.class,
                sessionId);
    }

    private String startEventResult(long sessionId) {
        return jdbc.queryForObject(
                "SELECT result::text FROM session_control_events WHERE session_id=?",
                String.class,
                sessionId);
    }

    private long startEventExpectedVersion(long sessionId) {
        return jdbc.queryForObject(
                "SELECT expected_version FROM session_control_events WHERE session_id=?",
                Long.class,
                sessionId);
    }

    private Long participantSessionId(long groupRunId, long userId) {
        return jdbc.query(
                """
                SELECT session_id FROM group_run_participants
                WHERE group_run_id=? AND user_id=?
                """,
                rs -> rs.next() ? rs.getObject(1, Long.class) : null,
                groupRunId,
                userId);
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

    private long insertCrew(long ownerId, String name) {
        return jdbc.queryForObject(
                """
                INSERT INTO crews(owner_id, name, capacity, status)
                VALUES (?, ?, 20, 'ACTIVE'::crews_status_enum)
                RETURNING id
                """,
                Long.class,
                ownerId,
                name);
    }

    private void approveMember(long crewId, long userId) {
        jdbc.update(
                """
                INSERT INTO crew_memberships(crew_id, user_id, status, joined_at)
                VALUES (?, ?, 'APPROVED'::crew_memberships_status_enum, now())
                """,
                crewId,
                userId);
    }

    private long insertDevice(long userId, String type) {
        return jdbc.queryForObject(
                """
                INSERT INTO user_devices(user_id, device_type, linked_at)
                VALUES (?, ?::user_devices_device_type_enum, now())
                RETURNING id
                """,
                Long.class,
                userId,
                type);
    }
}
