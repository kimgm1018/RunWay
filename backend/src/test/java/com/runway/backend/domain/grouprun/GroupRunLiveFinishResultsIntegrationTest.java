package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
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
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-261 slice 3. G12 강제 종료, G14 결과 조회, G10 실시간 현황 스텁. */
@SpringBootTest
@AutoConfigureMockMvc
class GroupRunLiveFinishResultsIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(GroupRunLiveFinishResultsIntegrationTest.class);

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

        hostId = insertUser("gr_lf_host", "호스트", "01044440001");
        memberId = insertUser("gr_lf_member", "멤버", "01044440002");
        outsiderId = insertUser("gr_lf_out", "외부인", "01044440003");
        hostWatchId = insertDevice(hostId, "WATCH");
        insertDevice(hostId, "PHONE");
        memberWatchId = insertDevice(memberId, "WATCH");
        insertDevice(memberId, "PHONE");
        crewId = insertCrew(hostId, "종료결과 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberId);
        approveMember(crewId, outsiderId);
    }

    // ---------------------------------------------------------------- G12

    @Test
    void forceFinish_hostCompletesGroup_andAbortsUnconfirmedStarts() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        long hostVersion = sessionVersion(hostSession);
        long memberVersion = sessionVersion(memberSession);

        JsonNode response =
                body(
                        forceFinish(groupRunId, hostId, "{}")
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                                .andExpect(jsonPath("$.status").value("COMPLETED"))
                                .andExpect(jsonPath("$.endedAt").isString())
                                .andReturn());

        assertThat(groupStatus(groupRunId)).isEqualTo("COMPLETED");
        Instant endedAt = groupEndedAt(groupRunId);
        assertThat(endedAt).isNotNull();
        assertThat(Instant.parse(response.get("endedAt").asString())).isEqualTo(endedAt);

        for (long sessionId : List.of(hostSession, memberSession)) {
            assertThat(sessionStatus(sessionId)).isEqualTo("INTERRUPTED");
            assertThat(sessionAnalysis(sessionId)).isEqualTo("FAILED");
            assertThat(startedAt(sessionId)).isNull();
            assertThat(sessionEndedAt(sessionId)).isNull();
            assertThat(eventResult(sessionId, "START")).isEqualTo("UNKNOWN");
            assertThat(eventReason(sessionId, "START")).isEqualTo("START_UNCONFIRMED_ABORTED");
            assertThat(eventCount(sessionId, "END")).isZero();
        }
        assertThat(sessionVersion(hostSession)).isEqualTo(hostVersion + 1);
        assertThat(sessionVersion(memberSession)).isEqualTo(memberVersion + 1);
    }

    @Test
    void forceFinish_preservesExistingUnknownStartReason() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());
        jdbc.update(
                """
                UPDATE session_control_events
                SET result = 'UNKNOWN'::session_control_events_result_enum,
                    reason_code = 'WATCH_DISCONNECTED'
                WHERE session_id = ? AND action = 'START'::session_control_events_action_enum
                """,
                hostSession);

        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        assertThat(sessionStatus(hostSession)).isEqualTo("INTERRUPTED");
        assertThat(eventResult(hostSession, "START")).isEqualTo("UNKNOWN");
        assertThat(eventReason(hostSession, "START")).isEqualTo("WATCH_DISCONNECTED");
    }

    @Test
    void forceFinish_startedSession_createsEndPendingOnControlDevice() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);

        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        // 시작된 세션은 END PENDING만 승인하고 상태·버전은 바꾸지 않는다.
        assertThat(sessionStatus(hostSession)).isEqualTo("RUNNING");
        assertThat(sessionVersion(hostSession)).isEqualTo(2L);
        assertThat(eventCount(hostSession, "END")).isEqualTo(1);
        assertThat(eventResult(hostSession, "END")).isEqualTo("PENDING");
        assertThat(eventDeviceId(hostSession, "END")).isEqualTo(hostWatchId);
        assertThat(eventExpectedVersion(hostSession, "END")).isEqualTo(2L);
        // 시작 미확인 세션은 같은 요청에서 중단된다.
        assertThat(sessionStatus(memberSession)).isEqualTo("INTERRUPTED");
        assertThat(eventCount(memberSession, "END")).isZero();
        assertThat(groupStatus(groupRunId)).isEqualTo("COMPLETED");
    }

    @Test
    void forceFinish_reusesExistingPendingEnd() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        insertEvent(hostSession, hostWatchId, "END", 2, "PENDING");

        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        assertThat(eventCount(hostSession, "END")).isEqualTo(1);
        assertThat(sessionStatus(hostSession)).isEqualTo("RUNNING");
        assertThat(groupStatus(groupRunId)).isEqualTo("COMPLETED");
    }

    @Test
    void forceFinish_otherPendingCommand_defersEnd_butGroupStillCompletes() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        insertEvent(hostSession, hostWatchId, "PAUSE", 2, "PENDING");

        forceFinish(groupRunId, hostId, "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        assertThat(eventCount(hostSession, "END")).isZero();
        assertThat(eventResult(hostSession, "PAUSE")).isEqualTo("PENDING");
        assertThat(sessionStatus(hostSession)).isEqualTo("RUNNING");
        assertThat(sessionStatus(memberSession)).isEqualTo("INTERRUPTED");
        assertThat(groupStatus(groupRunId)).isEqualTo("COMPLETED");
    }

    @Test
    void forceFinish_leavesTerminalSessionsAlone() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markCompleted(hostSession);
        jdbc.update(
                "UPDATE running_sessions SET status = 'CANCELLED'::running_sessions_status_enum WHERE id = ?",
                memberSession);
        long hostVersion = sessionVersion(hostSession);

        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        assertThat(sessionStatus(hostSession)).isEqualTo("COMPLETED");
        assertThat(sessionVersion(hostSession)).isEqualTo(hostVersion);
        assertThat(eventCount(hostSession, "END")).isZero();
        assertThat(sessionStatus(memberSession)).isEqualTo("CANCELLED");
    }

    @Test
    void forceFinish_repeated_returnsSameEndedAt_withoutReapplying() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());

        JsonNode first =
                body(forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk()).andReturn());
        long versionAfterFirst = sessionVersion(hostSession);
        Instant endedAt = groupEndedAt(groupRunId);

        JsonNode second =
                body(forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk()).andReturn());

        assertThat(second.get("endedAt").asString()).isEqualTo(first.get("endedAt").asString());
        assertThat(second.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(groupEndedAt(groupRunId)).isEqualTo(endedAt);
        assertThat(sessionVersion(hostSession)).isEqualTo(versionAfterFirst);
    }

    @Test
    void forceFinish_nonHost_forbidden_andNothingChanges() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());

        forceFinish(groupRunId, memberId, "{}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));
        forceFinish(groupRunId, outsiderId, "{}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));

        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(groupEndedAt(groupRunId)).isNull();
        assertThat(sessionStatus(hostSession)).isEqualTo("READY");
    }

    @Test
    void forceFinish_missingGroup_notFound() throws Exception {
        forceFinish(9_999_999L, hostId, "{}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    void forceFinish_notRunning_conflict() throws Exception {
        long scheduled = createGroupRun();
        readyHost(scheduled);
        forceFinish(scheduled, hostId, "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
        assertThat(groupStatus(scheduled)).isEqualTo("SCHEDULED");
        assertThat(groupEndedAt(scheduled)).isNull();

        long cancelled = createGroupRun();
        cancel(cancelled, hostId).andExpect(status().isOk());
        forceFinish(cancelled, hostId, "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
        assertThat(groupStatus(cancelled)).isEqualTo("CANCELLED");
        assertThat(groupEndedAt(cancelled)).isNull();
    }

    @Test
    void forceFinish_emptyBody_isAccepted() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/force-finish", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    // ---------------------------------------------------------------- G14

    @Test
    void results_afterForceFinish_listsAllParticipants() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        results(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                .andExpect(jsonPath("$.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.targetDurationSec").value(1800))
                .andExpect(jsonPath("$.analysis.status").value("PROCESSING"))
                .andExpect(jsonPath("$.hasUnconfirmedStarts").value(false))
                .andExpect(jsonPath("$.participants", hasSize(2)))
                .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                .andExpect(jsonPath("$.participants[0].sessionId").value(hostSession))
                .andExpect(jsonPath("$.participants[0].startResult").value("APPLIED"))
                .andExpect(jsonPath("$.participants[0].state").value("RUNNING"))
                .andExpect(jsonPath("$.participants[0].analysis.status").value("PENDING"))
                .andExpect(jsonPath("$.participants[0].actualDistanceM").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                .andExpect(jsonPath("$.participants[1].sessionId").value(memberSession))
                .andExpect(jsonPath("$.participants[1].startResult").value("UNKNOWN"))
                .andExpect(jsonPath("$.participants[1].state").value("INTERRUPTED"))
                .andExpect(jsonPath("$.participants[1].analysis").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].actualDistanceM").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].movingDurationSec").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].averagePaceSecPerKm").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].goalAchieved").value(nullValue()));
    }

    @Test
    void results_unconfirmedStart_isProcessing_andFlagged() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());

        results(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis.status").value("PROCESSING"))
                .andExpect(jsonPath("$.hasUnconfirmedStarts").value(true))
                .andExpect(jsonPath("$.participants[0].startResult").value("PENDING"))
                .andExpect(jsonPath("$.participants[0].state").value("READY"))
                .andExpect(jsonPath("$.participants[0].analysis").value(nullValue()));
    }

    @Test
    void results_allStartedSettled_isReady_withMeasurements() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markCompleted(hostSession);
        jdbc.update(
                """
                UPDATE running_sessions
                SET analysis_status = 'READY'::running_sessions_analysis_status_enum,
                    total_distance = 5000, moving_duration = 1800, average_pace = 360,
                    goal_achieved = TRUE
                WHERE id = ?
                """,
                hostSession);
        // 시작하지 않고 중단된 참가자는 분석 대기에서 제외된다.
        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        results(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis.status").value("READY"))
                .andExpect(jsonPath("$.hasUnconfirmedStarts").value(false))
                .andExpect(jsonPath("$.participants[0].state").value("COMPLETED"))
                .andExpect(jsonPath("$.participants[0].analysis.status").value("READY"))
                .andExpect(jsonPath("$.participants[0].actualDistanceM").value(5000.0))
                .andExpect(jsonPath("$.participants[0].movingDurationSec").value(1800))
                .andExpect(jsonPath("$.participants[0].averagePaceSecPerKm").value(360.0))
                .andExpect(jsonPath("$.participants[0].goalAchieved").value(true))
                .andExpect(jsonPath("$.participants[1].sessionId").value(memberSession))
                .andExpect(jsonPath("$.participants[1].actualDistanceM").value(nullValue()));
    }

    @Test
    void results_failedAnalysis_isFailed() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markCompleted(hostSession);
        jdbc.update(
                "UPDATE running_sessions SET analysis_status = 'FAILED'::running_sessions_analysis_status_enum WHERE id = ?",
                hostSession);

        results(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis.status").value("FAILED"))
                .andExpect(jsonPath("$.participants[0].analysis.status").value("FAILED"));
    }

    @Test
    void results_isReadOnly_doesNotFinishOrAnalyze() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        long version = sessionVersion(hostSession);
        int events = totalEventCount();

        results(groupRunId, hostId).andExpect(status().isOk());
        results(groupRunId, hostId).andExpect(status().isOk());

        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(groupEndedAt(groupRunId)).isNull();
        assertThat(sessionStatus(hostSession)).isEqualTo("RUNNING");
        assertThat(sessionAnalysis(hostSession)).isEqualTo("PENDING");
        assertThat(sessionVersion(hostSession)).isEqualTo(version);
        assertThat(totalEventCount()).isEqualTo(events);
    }

    @Test
    void results_nonParticipant_forbidden_missingGroup_notFound() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);

        results(groupRunId, outsiderId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_PARTICIPANT"));
        results(9_999_999L, hostId)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    // ---------------------------------------------------------------- G10

    @Test
    void live_stub_returnsOnlyStatusAndParticipantIds() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        int events = totalEventCount();

        MvcResult result =
                live(groupRunId, memberId)
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                        .andExpect(jsonPath("$.status").value("RUNNING"))
                        .andExpect(jsonPath("$.courseId").value(nullValue()))
                        .andExpect(jsonPath("$.updatedAt").isString())
                        .andExpect(jsonPath("$.participants", hasSize(2)))
                        .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                        .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                        .andReturn();

        JsonNode json = body(result);
        List<String> topKeys = new ArrayList<>();
        json.propertyNames().forEach(topKeys::add);
        assertThat(topKeys)
                .containsExactlyInAnyOrder(
                        "groupRunId", "status", "courseId", "updatedAt", "participants");
        List<String> participantKeys = new ArrayList<>();
        json.get("participants").get(0).propertyNames().forEach(participantKeys::add);
        assertThat(participantKeys).containsExactly("userId");

        // 부수 효과가 없다.
        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(totalEventCount()).isEqualTo(events);
    }

    @Test
    void live_nonParticipant_forbidden_missingGroup_notFound() throws Exception {
        long groupRunId = createGroupRun();

        live(groupRunId, outsiderId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_PARTICIPANT"));
        live(9_999_999L, hostId)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    // ---------------------------------------------------------------- helpers

    private ResultActions forceFinish(long groupRunId, long userId, String json) throws Exception {
        return mockMvc.perform(
                post("/api/v1/group-runs/{id}/force-finish", groupRunId)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json));
    }

    private ResultActions results(long groupRunId, long userId) throws Exception {
        return mockMvc.perform(
                get("/api/v1/group-runs/{id}/results", groupRunId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private ResultActions live(long groupRunId, long userId) throws Exception {
        return mockMvc.perform(
                get("/api/v1/group-runs/{id}/live", groupRunId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private ResultActions cancel(long groupRunId, long userId) throws Exception {
        return mockMvc.perform(
                post("/api/v1/group-runs/{id}/cancel", groupRunId)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cancelReason\":\"WEATHER\"}"));
    }

    private ResultActions start(long groupRunId, long userId) throws Exception {
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

    private long joinAndReady(long groupRunId, long userId) throws Exception {
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk());
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
                  "title":"종료결과 그룹런",
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

    /** START를 APPLIED로 확정하고 세션을 RUNNING(버전 2)으로 만든 것과 같은 상태로 맞춘다. */
    private void markStarted(long sessionId) {
        jdbc.update(
                """
                UPDATE session_control_events
                SET result = 'APPLIED'::session_control_events_result_enum, applied_at = ?
                WHERE session_id = ? AND action = 'START'::session_control_events_action_enum
                """,
                Timestamp.from(Instant.now().minusSeconds(600)),
                sessionId);
        jdbc.update(
                """
                UPDATE running_sessions
                SET status = 'RUNNING'::running_sessions_status_enum,
                    started_at = ?, state_version = 2
                WHERE id = ?
                """,
                Timestamp.from(Instant.now().minusSeconds(600)),
                sessionId);
    }

    private void markCompleted(long sessionId) {
        jdbc.update(
                """
                UPDATE running_sessions
                SET status = 'COMPLETED'::running_sessions_status_enum,
                    ended_at = ?, state_version = 3
                WHERE id = ?
                """,
                Timestamp.from(Instant.now().minusSeconds(60)),
                sessionId);
    }

    private void insertEvent(
            long sessionId, long deviceId, String action, long expectedVersion, String result) {
        jdbc.update(
                """
                INSERT INTO session_control_events(session_id, device_id, action, expected_version, result)
                VALUES (?, ?, ?::session_control_events_action_enum, ?,
                        ?::session_control_events_result_enum)
                """,
                sessionId,
                deviceId,
                action,
                expectedVersion,
                result);
    }

    private String groupStatus(long groupRunId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM group_runs WHERE id=?", String.class, groupRunId);
    }

    private Instant groupEndedAt(long groupRunId) {
        return jdbc.query(
                "SELECT ended_at FROM group_runs WHERE id=?",
                rs -> {
                    if (!rs.next()) {
                        return null;
                    }
                    Timestamp value = rs.getTimestamp(1);
                    return value == null ? null : value.toInstant();
                },
                groupRunId);
    }

    private String sessionStatus(long sessionId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM running_sessions WHERE id=?", String.class, sessionId);
    }

    private String sessionAnalysis(long sessionId) {
        return jdbc.queryForObject(
                "SELECT analysis_status::text FROM running_sessions WHERE id=?",
                String.class,
                sessionId);
    }

    private long sessionVersion(long sessionId) {
        return jdbc.queryForObject(
                "SELECT state_version FROM running_sessions WHERE id=?", Long.class, sessionId);
    }

    private Instant startedAt(long sessionId) {
        return timestamp("SELECT started_at FROM running_sessions WHERE id=?", sessionId);
    }

    private Instant sessionEndedAt(long sessionId) {
        return timestamp("SELECT ended_at FROM running_sessions WHERE id=?", sessionId);
    }

    private Instant timestamp(String sql, long id) {
        return jdbc.query(
                sql,
                rs -> {
                    if (!rs.next()) {
                        return null;
                    }
                    Timestamp value = rs.getTimestamp(1);
                    return value == null ? null : value.toInstant();
                },
                id);
    }

    private int eventCount(long sessionId, String action) {
        return jdbc.queryForObject(
                """
                SELECT count(*) FROM session_control_events
                WHERE session_id=? AND action=?::session_control_events_action_enum
                """,
                Integer.class,
                sessionId,
                action);
    }

    private int totalEventCount() {
        return jdbc.queryForObject("SELECT count(*) FROM session_control_events", Integer.class);
    }

    private String eventResult(long sessionId, String action) {
        return jdbc.queryForObject(
                """
                SELECT result::text FROM session_control_events
                WHERE session_id=? AND action=?::session_control_events_action_enum
                ORDER BY id LIMIT 1
                """,
                String.class,
                sessionId,
                action);
    }

    private String eventReason(long sessionId, String action) {
        return jdbc.queryForObject(
                """
                SELECT reason_code FROM session_control_events
                WHERE session_id=? AND action=?::session_control_events_action_enum
                ORDER BY id LIMIT 1
                """,
                String.class,
                sessionId,
                action);
    }

    private long eventDeviceId(long sessionId, String action) {
        return jdbc.queryForObject(
                """
                SELECT device_id FROM session_control_events
                WHERE session_id=? AND action=?::session_control_events_action_enum
                ORDER BY id LIMIT 1
                """,
                Long.class,
                sessionId,
                action);
    }

    private long eventExpectedVersion(long sessionId, String action) {
        return jdbc.queryForObject(
                """
                SELECT expected_version FROM session_control_events
                WHERE session_id=? AND action=?::session_control_events_action_enum
                ORDER BY id LIMIT 1
                """,
                Long.class,
                sessionId,
                action);
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
