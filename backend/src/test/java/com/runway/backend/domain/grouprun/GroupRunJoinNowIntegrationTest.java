package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-889 phase 2. G18 지금 출발과 기록 기기 교체. */
class GroupRunJoinNowIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper mapper;

    private long hostId;
    private long memberId;
    private long crewOnlyId;
    private long outsiderId;
    private long crewId;
    private long hostWatchId;
    private long memberWatchId;

    @BeforeEach
    void seed() {
        hostId = insertUser("gr_sc_host", "호스트", "01033330001");
        memberId = insertUser("gr_sc_member", "멤버", "01033330002");
        crewOnlyId = insertUser("gr_sc_crew", "크루만", "01033330004");
        outsiderId = insertUser("gr_sc_out", "외부인", "01033330003");
        hostWatchId = insertDevice(hostId, "WATCH");
        insertDevice(hostId, "PHONE");
        memberWatchId = insertDevice(memberId, "WATCH");
        insertDevice(memberId, "PHONE");
        crewId = insertCrew(hostId, "시작취소 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberId);
        approveMember(crewId, crewOnlyId);
        enableGroupNotifications(hostId);
        enableGroupNotifications(memberId);
        enableGroupNotifications(crewOnlyId);
    }


    @Test
    void startlessReady_approvesSameSession_andRetryReusesCommand() throws Exception {
        long group = createGroupRun();
        long session = readyHost(group);
        jdbc.update("UPDATE group_runs SET status='RUNNING' WHERE id=?", group);
        JsonNode first = body(joinNow(group, hostId, null).andExpect(status().isOk()).andReturn());
        assertThat(first.get("sessionId").asLong()).isEqualTo(session);
        assertThat(first.get("result").asText()).isEqualTo("PENDING");
        assertThat(body(joinNow(group, hostId, "{}").andExpect(status().isOk()).andReturn()))
                .isEqualTo(first);
        assertThat(startEventCount(session)).isEqualTo(1);
        assertThat(sessionCount(hostId)).isEqualTo(1);
    }

    @Test
    void pendingG09Start_isReusedByJoinNow() throws Exception {
        long group = createGroupRun();
        long session = readyHost(group);
        JsonNode approved = body(start(group, hostId).andExpect(status().isOk()).andReturn())
                .get("participants").get(0);
        assertThat(body(joinNow(group, hostId, "{}").andExpect(status().isOk()).andReturn()))
                .isEqualTo(approved);
        assertThat(startEventCount(session)).isEqualTo(1);
        assertThat(sessionCount(hostId)).isEqualTo(1);
    }

    @Test
    void noLinkedSession_defaultsToPhoneWhenWatchIsUnlinked() throws Exception {
        long group = createGroupRun();
        readyHost(group);
        joinOnly(group, memberId);
        start(group, hostId).andExpect(status().isOk());
        jdbc.update("UPDATE user_devices SET unlinked_at=now() WHERE id=?", memberWatchId);
        long session = body(joinNow(group, memberId, null).andExpect(status().isOk()).andReturn())
                .get("sessionId").asLong();
        assertThat(participantSessionId(group, memberId)).isEqualTo(session);
        assertThat(jdbc.queryForObject("SELECT phone_only FROM running_sessions WHERE id=?",
                Boolean.class, session)).isTrue();
        assertThat(startEventResult(session)).isEqualTo("PENDING");
    }

    @Test
    void failedReplacement_rollsBackOldSessionAbort() throws Exception {
        long group = createGroupRun();
        long old = readyHost(group);
        start(group, hostId).andExpect(status().isOk());
        jdbc.update("UPDATE user_devices SET unlinked_at=now() WHERE user_id=? AND device_type='PHONE'",
                hostId);
        joinNow(group, hostId, "{\"recordingDevice\":\"PHONE\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("DEVICE_NOT_FOUND"));
        assertThat(sessionStatus(old)).isEqualTo("READY");
        assertThat(startEventResult(old)).isEqualTo("PENDING");
        assertThat(participantSessionId(group, hostId)).isEqualTo(old);
        assertThat(sessionCount(hostId)).isEqualTo(1);
    }

    @Test
    void terminalSessionWithActualStart_cannotRunAgain() throws Exception {
        long group = createGroupRun();
        long session = readyHost(group);
        start(group, hostId).andExpect(status().isOk());
        for (String state : List.of("COMPLETED", "INTERRUPTED", "CANCELLED")) {
            jdbc.update("""
                    UPDATE running_sessions SET status=?::running_sessions_status_enum,
                        started_at=now(), ended_at=now() WHERE id=?
                    """, state, session);
            joinNow(group, hostId, "{\"recordingDevice\":\"PHONE\"}")
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        }
        assertThat(sessionCount(hostId)).isEqualTo(1);
    }

    @Test
    void runningGroupWithEndedAt_rejectsJoinNow() throws Exception {
        long group = createGroupRun();
        readyHost(group);
        start(group, hostId).andExpect(status().isOk());
        jdbc.update("UPDATE group_runs SET ended_at=now() WHERE id=?", group);
        joinNow(group, hostId, "{}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    @Test
    void unknownWatchStart_switchesToPhone_retries_andRejectsLateWatchApplied() throws Exception {
        long group = createGroupRun();
        readyHost(group);
        long old = joinAndReady(group, memberId);
        start(group, hostId).andExpect(status().isOk());
        long oldCommand = startCommand(old);
        reportStart(old, memberId, memberWatchId, oldCommand, "UNKNOWN")
                .andExpect(status().isOk());
        JsonNode first = body(joinNow(group, memberId, "{\"recordingDevice\":\"PHONE\"}")
                .andExpect(status().isOk()).andReturn());
        long replacement = first.get("sessionId").asLong();
        long command = first.get("commandId").asLong();
        assertThat(replacement).isNotEqualTo(old);
        assertAborted(old);
        assertThat(participantSessionId(group, memberId)).isEqualTo(replacement);
        assertThat(jdbc.queryForObject("SELECT phone_only FROM running_sessions WHERE id=?",
                Boolean.class, replacement)).isTrue();
        long phone = jdbc.queryForObject("SELECT relay_device_id FROM running_sessions WHERE id=?",
                Long.class, replacement);
        assertThat(startEventDeviceId(replacement)).isEqualTo(phone);
        assertThat(first.get("result").asText()).isEqualTo("PENDING");
        assertThat(body(joinNow(group, memberId, "{\"recordingDevice\":\"PHONE\"}")
                .andExpect(status().isOk()).andReturn())).isEqualTo(first);
        assertThat(sessionCount(memberId)).isEqualTo(2);
        reportStart(old, memberId, memberWatchId, oldCommand, "APPLIED")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        assertThat(sessionStatus(replacement)).isEqualTo("READY");
        assertThat(startEventResult(replacement)).isEqualTo("PENDING");
        reportStart(replacement, memberId, phone, command, "APPLIED")
                .andExpect(status().isOk()).andExpect(jsonPath("$.state").value("RUNNING"));
        mockMvc.perform(get("/api/v1/group-runs/{id}/live", group)
                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[?(@.userId == " + memberId + ")]").isNotEmpty());
    }

    @Test
    void invalidGroupSessionParticipantAndDevice_areRejected() throws Exception {
        long group = createGroupRun();
        long session = readyHost(group);
        joinNow(group, hostId, null).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
        start(group, hostId).andExpect(status().isOk());
        joinNow(group, crewOnlyId, "{}").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_PARTICIPANT"));
        for (String device : List.of("INVALID", "phone", "")) {
            joinNow(group, hostId, "{\"recordingDevice\":\"" + device + "\"}")
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        reportStart(session, hostId, hostWatchId, startCommand(session), "APPLIED")
                .andExpect(status().isOk());
        joinNow(group, hostId, "{}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        jdbc.update("UPDATE group_runs SET status='COMPLETED', ended_at=now() WHERE id=?", group);
        joinNow(group, hostId, "{}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    @Test
    void forceFinish_afterReplacement_abortsPendingStart_andPreventsJoiningAgain() throws Exception {
        long group = createGroupRun();
        readyHost(group);
        start(group, hostId).andExpect(status().isOk());
        long replacement = body(joinNow(group, hostId, "{\"recordingDevice\":\"PHONE\"}")
                .andExpect(status().isOk()).andReturn()).get("sessionId").asLong();
        mockMvc.perform(post("/api/v1/group-runs/{id}/force-finish", group)
                .header("Authorization", SecurityTestSupport.bearer(hostId))
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());
        assertAborted(replacement);
        joinNow(group, hostId, "{\"recordingDevice\":\"PHONE\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    private void assertAborted(long session) {
        assertThat(sessionStatus(session)).isEqualTo("INTERRUPTED");
        assertThat(startEventResult(session)).isEqualTo("UNKNOWN");
        assertThat(jdbc.queryForObject("SELECT reason_code FROM session_control_events WHERE id=?",
                String.class, startCommand(session))).isEqualTo("START_UNCONFIRMED_ABORTED");
    }

    private int sessionCount(long user) {
        return jdbc.queryForObject("SELECT count(*) FROM running_sessions WHERE user_id=?",
                Integer.class, user);
    }

    private long startCommand(long session) {
        return jdbc.queryForObject("SELECT id FROM session_control_events WHERE session_id=? AND action='START'",
                Long.class, session);
    }

    private org.springframework.test.web.servlet.ResultActions joinNow(long group, long user, String json)
            throws Exception {
        var request = post("/api/v1/group-runs/{id}/participants/me/start", group)
                .header("Authorization", SecurityTestSupport.bearer(user));
        if (json != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(json);
        }
        return mockMvc.perform(request);
    }

    private org.springframework.test.web.servlet.ResultActions reportStart(
            long session, long user, long device, long command, String result) throws Exception {
        return mockMvc.perform(post("/api/v1/running-sessions/{id}/start", session)
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"phase":"RESULT","deviceId":%d,"commandId":%d,"result":"%s",
                         "appliedAt":%s,"reasonCode":%s}
                        """.formatted(device, command, result,
                        "APPLIED".equals(result) ? "\"2026-11-17T01:00:00Z\"" : "null",
                        "UNKNOWN".equals(result) ? "\"WATCH_DISCONNECTED\"" : "null")));
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
                  "scheduledAt":"%s",
                  "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                  "meetingPlaceName":"집결지",
                  "meetingAddress":"부산",
                  "targetDistanceM":5000,
                  "goalInputType":"TIME",
                  "targetDurationSec":1800
                }
                """
                .formatted(crewId, GroupRunTestTimes.validScheduledAt());
    }

    private String sessionStatus(long sessionId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM running_sessions WHERE id=?", String.class, sessionId);
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
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
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

    private void enableGroupNotifications(long userId) {
        jdbc.update(
                """
                INSERT INTO user_settings(
                    user_id, voice_coaching_enabled, bpm_guide_enabled,
                    group_notifications_enabled, community_notifications_enabled,
                    location_collection_mode, account_visibility)
                VALUES (?, false, false, true, false, 'OFF', 'PRIVATE')
                ON CONFLICT (user_id) DO UPDATE SET group_notifications_enabled=true
                """,
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
