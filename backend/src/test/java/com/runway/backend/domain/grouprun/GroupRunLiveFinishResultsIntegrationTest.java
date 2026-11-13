package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-261 slice 3. G12 강제 종료, G14 결과 조회, G10 실시간 순위·격차. */
class GroupRunLiveFinishResultsIntegrationTest extends SharedContextIntegrationSupport {
    private static final List<String> PARTICIPANT_KEYS =
            List.of(
                    "userId",
                    "rank",
                    "aheadCount",
                    "behindCount",
                    "gapToAheadM",
                    "gapToBehindM",
                    "progressM",
                    "paceSecPerKm",
                    "measuredAt",
                    "stale");

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
    void groupPaceFlagOff_storedAiStateDoesNotChangeG03OrG10ResponseBytes() throws Exception {
        long id = createGroupRun();
        insertProfile(hostId, 360);
        String detailBefore = mockMvc.perform(get("/api/v1/group-runs/{id}", id)
                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String liveBefore = live(id, hostId).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        jdbc.update("""
                INSERT INTO group_run_pace_state(group_run_id,group_pace_sec_per_km,
                    start_recommended_pace_sec_per_km,struggling_count) VALUES (?,450,480,3)
                """, id);
        assertThat(mockMvc.perform(get("/api/v1/group-runs/{id}", id)
                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .isEqualTo(detailBefore);
        assertThat(live(id, hostId).andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .isEqualTo(liveBefore);
        jdbc.update("UPDATE group_runs SET status='RUNNING' WHERE id=?", id);
        String runningBefore = live(id, hostId).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        jdbc.update("UPDATE group_run_pace_state SET group_pace_sec_per_km=500, struggling_count=7 WHERE group_run_id=?", id);
        assertThat(live(id, hostId).andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .isEqualTo(runningBefore);
    }

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
    void live_scheduled_withProfiles_returnsMedianGuidePace() throws Exception {
        insertProfile(hostId, 300);
        insertProfile(memberId, 400);
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(350));
    }

    @Test
    void live_running_usesMeasuredSpeeds_andExcludesCompletedParticipant() throws Exception {
        insertProfile(hostId, 500);
        insertProfile(memberId, 500);
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        // 실측 320·380 → 중앙값 350. 종료 후 average_pace는 guide에 쓰지 않는다.
        insertSample(hostSession, now.minusSeconds(3), 800.0, speedMpsForPace(320));
        insertSample(memberSession, now.minusSeconds(3), 700.0, speedMpsForPace(380));

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RUNNING"))
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(350));

        markCompleted(memberSession);

        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RUNNING"))
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(320));
    }

    @Test
    void live_running_prefersCoachingPaceOverMeasuredSpeed() throws Exception {
        insertProfile(hostId, 500);
        insertProfile(memberId, 500);
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        insertSample(hostSession, now.minusSeconds(3), 800.0, speedMpsForPace(400));
        insertSample(memberSession, now.minusSeconds(3), 700.0, speedMpsForPace(400));
        insertCoachingDecision(hostSession, 300);
        insertCoachingDecision(memberSession, 360);

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(330));
    }

    @Test
    void live_scheduled_returnsNullRanks_andStale_withGuidePace() throws Exception {
        long groupRunId = createGroupRun();
        readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);

        MvcResult result =
                live(groupRunId, memberId)
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                        .andExpect(jsonPath("$.status").value("SCHEDULED"))
                        // 추천 페이스는 참가자 프로필 중앙값(테스트에는 프로필 없음 -> null). 목표 환산(360)으로 채우지 않는다.
                        .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(nullValue()))
                        .andExpect(jsonPath("$.participants", hasSize(2)))
                        .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                        .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                        .andReturn();

        JsonNode json = body(result);
        for (JsonNode p : json.get("participants")) {
            assertThat(propertyNames(p)).containsExactlyElementsOf(PARTICIPANT_KEYS);
            assertThat(p.get("rank").isNull()).isTrue();
            assertThat(p.get("aheadCount").isNull()).isTrue();
            assertThat(p.get("behindCount").isNull()).isTrue();
            assertThat(p.get("gapToAheadM").isNull()).isTrue();
            assertThat(p.get("gapToBehindM").isNull()).isTrue();
            assertThat(p.get("progressM").isNull()).isTrue();
            assertThat(p.get("paceSecPerKm").isNull()).isTrue();
            assertThat(p.get("measuredAt").isNull()).isTrue();
            assertThat(p.get("stale").asBoolean()).isTrue();
        }
        assertThat(json.get("loadAlert").isNull()).isTrue();
    }

    @Test
    void live_running_withoutSamples_returnsSchemaKeys_nullRanks_andNoSideEffects()
            throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        int events = totalEventCount();
        long version = sessionVersion(hostSession);

        MvcResult result =
                live(groupRunId, memberId)
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                        .andExpect(jsonPath("$.status").value("RUNNING"))
                        .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(nullValue()))
                        .andExpect(jsonPath("$.courseId").value(nullValue()))
                        .andExpect(jsonPath("$.updatedAt").isString())
                        .andExpect(jsonPath("$.participants", hasSize(2)))
                        .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                        .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                        .andReturn();

        JsonNode json = body(result);
        assertThat(propertyNames(json))
                .containsExactlyInAnyOrder(
                        "groupRunId",
                        "status",
                        "groupGuidePaceSecPerKm",
                        "courseId",
                        "updatedAt",
                        "loadAlert",
                        "participants");
        for (JsonNode p : json.get("participants")) {
            assertThat(propertyNames(p)).containsExactlyElementsOf(PARTICIPANT_KEYS);
            // 표본이 없으면 순위 0·거리 0으로 채우지 않고 null + stale로 돌려준다.
            assertThat(p.get("rank").isNull()).isTrue();
            assertThat(p.get("progressM").isNull()).isTrue();
            assertThat(p.get("stale").asBoolean()).isTrue();
        }

        // 부수 효과가 없다.
        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(totalEventCount()).isEqualTo(events);
        assertThat(sessionVersion(hostSession)).isEqualTo(version);
    }

    @Test
    void live_running_ranksByLatestDistance_andMarksStaleOrIneligibleAsUnranked()
            throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        // 최신 표본이 기준: 오래된 표본(더 큰 거리)은 무시되고 5초 전 표본이 쓰인다.
        insertSample(hostSession, now.minusSeconds(300), 900.0);
        insertSample(hostSession, now.minusSeconds(5), 1200.5);
        insertSample(memberSession, now.minusSeconds(8), 1000.0);
        int events = totalEventCount();

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                .andExpect(jsonPath("$.participants[0].rank").value(1))
                .andExpect(jsonPath("$.participants[0].aheadCount").value(0))
                .andExpect(jsonPath("$.participants[0].behindCount").value(1))
                .andExpect(jsonPath("$.participants[0].gapToAheadM").value(nullValue()))
                .andExpect(jsonPath("$.participants[0].gapToBehindM").value(200.5))
                .andExpect(jsonPath("$.participants[0].progressM").value(1200.5))
                .andExpect(jsonPath("$.participants[0].measuredAt").isString())
                .andExpect(jsonPath("$.participants[0].stale").value(false))
                .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                .andExpect(jsonPath("$.participants[1].rank").value(2))
                .andExpect(jsonPath("$.participants[1].aheadCount").value(1))
                .andExpect(jsonPath("$.participants[1].behindCount").value(0))
                .andExpect(jsonPath("$.participants[1].gapToAheadM").value(200.5))
                .andExpect(jsonPath("$.participants[1].gapToBehindM").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].progressM").value(1000.0))
                .andExpect(jsonPath("$.participants[1].stale").value(false));

        // TTL(60초)을 넘긴 표본은 비순위 + stale. 남은 참가자가 순위를 이어받는다.
        jdbc.update("DELETE FROM running_metric_samples WHERE running_session_id = ?", memberSession);
        insertSample(memberSession, now.minusSeconds(120), 1500.0);
        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].rank").value(1))
                .andExpect(jsonPath("$.participants[0].aheadCount").value(0))
                .andExpect(jsonPath("$.participants[0].behindCount").value(0))
                .andExpect(jsonPath("$.participants[0].gapToBehindM").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].rank").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].progressM").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].stale").value(true));

        // 일시정지 세션은 신선한 표본이 있어도 순위에서 제외된다.
        jdbc.update("DELETE FROM running_metric_samples WHERE running_session_id = ?", memberSession);
        insertSample(memberSession, now.minusSeconds(2), 1500.0);
        jdbc.update(
                "UPDATE running_sessions SET status = 'PAUSED'::running_sessions_status_enum WHERE id = ?",
                memberSession);
        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].rank").value(1))
                .andExpect(jsonPath("$.participants[1].rank").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].gapToAheadM").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].stale").value(true));

        // GET은 상태·이벤트를 바꾸지 않는다.
        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(totalEventCount()).isEqualTo(events);
    }

    @Test
    void live_running_standingParticipant_staysRanked_whileOtherSamplesAreFresh()
            throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        // 597: 호스트는 걷고 멤버는 서 있다. 멤버 거리 표본은 90초 전에 멈췄지만 심박 표본은 이어진다.
        insertSample(hostSession, now.minusSeconds(3), 179.0, speedMpsForPace(360));
        Instant memberDistanceAt = now.minusSeconds(90).truncatedTo(ChronoUnit.SECONDS);
        // 멈추기 직전에는 빠르게 달렸다(거리 표본에 속도 포함).
        insertSample(memberSession, memberDistanceAt, 46.0, speedMpsForPace(240));
        Instant memberHeartRateAt = now.minusSeconds(5).truncatedTo(ChronoUnit.SECONDS);
        insertHeartRateSample(memberSession, now.minusSeconds(30));
        insertHeartRateSample(memberSession, memberHeartRateAt);
        // 미래 시각 심박 표본은 신선도 판단에 쓰지 않는다(ceiling 밖).
        insertHeartRateSample(memberSession, now.plusSeconds(300));
        int events = totalEventCount();

        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].rank").value(1))
                .andExpect(jsonPath("$.participants[0].gapToBehindM").value(133.0))
                .andExpect(jsonPath("$.participants[0].paceSecPerKm").value(360))
                .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                .andExpect(jsonPath("$.participants[1].rank").value(2))
                .andExpect(jsonPath("$.participants[1].progressM").value(46.0))
                .andExpect(jsonPath("$.participants[1].gapToAheadM").value(133.0))
                // 최신 측정 표본 기준 60초 안에 움직인 속도가 없으므로 멈추기 전 페이스를 보이지 않는다.
                .andExpect(jsonPath("$.participants[1].paceSecPerKm").value(nullValue()))
                // 멈추기 전 240초/km가 남았다면 부담 참가자로 잡혔을 상황이지만, 서 있는 참가자는 알림 대상이 아니다.
                .andExpect(jsonPath("$.loadAlert").value(nullValue()))
                .andExpect(
                        jsonPath("$.participants[1].measuredAt")
                                .value(memberHeartRateAt.toString()))
                .andExpect(jsonPath("$.participants[1].stale").value(false));

        // 측정 표본이 60초 넘게 전혀 없으면(미래 표본만 남음) 기존처럼 stale.
        jdbc.update(
                "DELETE FROM running_metric_samples WHERE running_session_id = ? AND measured_at > ?",
                memberSession,
                Timestamp.from(now.minusSeconds(60)));
        insertHeartRateSample(memberSession, now.plusSeconds(300));
        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].behindCount").value(0))
                .andExpect(jsonPath("$.participants[1].rank").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].progressM").value(nullValue()))
                // 미래 표본이 아니라 허용 시각 이하의 마지막 표본(거리 표본)으로 판단했다.
                .andExpect(
                        jsonPath("$.participants[1].measuredAt").value(memberDistanceAt.toString()))
                .andExpect(jsonPath("$.participants[1].stale").value(true));

        // 일시정지 참가자는 심박 표본이 신선해도 제외된다.
        insertHeartRateSample(memberSession, now.minusSeconds(2));
        jdbc.update(
                "UPDATE running_sessions SET status = 'PAUSED'::running_sessions_status_enum WHERE id = ?",
                memberSession);
        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[1].rank").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].stale").value(true));

        assertThat(groupStatus(groupRunId)).isEqualTo("RUNNING");
        assertThat(totalEventCount()).isEqualTo(events);
    }

    @Test
    void live_running_keepsMeasuredPace_whenLatestSampleIsHeartRateOnly() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        // 워치는 지표별로 따로 보내므로 달리는 중에도 최신 행이 심박 단독일 수 있다. 60초 창 안의 속도로 페이스를 유지한다.
        insertSample(hostSession, now.minusSeconds(10), 500.0, speedMpsForPace(330));
        insertHeartRateSample(hostSession, now.minusSeconds(2));
        insertSample(memberSession, now.minusSeconds(3), 400.0, speedMpsForPace(360));

        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                .andExpect(jsonPath("$.participants[0].rank").value(1))
                .andExpect(jsonPath("$.participants[0].paceSecPerKm").value(330))
                .andExpect(jsonPath("$.participants[0].stale").value(false))
                .andExpect(jsonPath("$.participants[1].paceSecPerKm").value(360));
    }

    @Test
    void live_running_ignoresFutureMeasuredAt_andKeepsEarlierValidSample() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        // 정상 표본 뒤에 미래 시각·과장 거리가 와도 최신 후보에서 제외되어 정상 표본이 남는다.
        insertSample(hostSession, now.minusSeconds(5), 800.0);
        insertSample(hostSession, now.plusSeconds(300), 99999.0);
        insertSample(memberSession, now.minusSeconds(4), 500.0);

        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                .andExpect(jsonPath("$.participants[0].rank").value(1))
                .andExpect(jsonPath("$.participants[0].progressM").value(800.0))
                .andExpect(jsonPath("$.participants[0].stale").value(false))
                .andExpect(jsonPath("$.participants[1].rank").value(2))
                .andExpect(jsonPath("$.participants[1].progressM").value(500.0));
    }

    @Test
    void live_running_returnsMeasuredPace_andLoadAlertForFastMember() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        // 안내 페이스 = 중앙값(300, 400) = 350. host 300 <= 350 - 30 이므로 부담, member 400은 아님.
        Instant now = Instant.now();
        insertSample(hostSession, now.minusSeconds(3), 1200.0, speedMpsForPace(300));
        insertSample(memberSession, now.minusSeconds(3), 1000.0, speedMpsForPace(400));
        int events = totalEventCount();

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(350))
                .andExpect(jsonPath("$.loadAlert.memberCount").value(1))
                .andExpect(jsonPath("$.loadAlert.nextPaceSecPerKm").value(365))
                .andExpect(jsonPath("$.participants[0].userId").value(hostId))
                .andExpect(jsonPath("$.participants[0].paceSecPerKm").value(300))
                .andExpect(jsonPath("$.participants[1].userId").value(memberId))
                .andExpect(jsonPath("$.participants[1].paceSecPerKm").value(400));
        assertThat(totalEventCount()).isEqualTo(events);
    }

    @Test
    void live_running_withinMargin_hasNullLoadAlert_butKeepsPaces() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        // 안내 페이스 350. host 321 > 350 - 30 이므로 경계 밖(부담 아님).
        Instant now = Instant.now();
        insertSample(hostSession, now.minusSeconds(3), 1200.0, speedMpsForPace(321));
        insertSample(memberSession, now.minusSeconds(3), 1000.0, speedMpsForPace(379));

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(350))
                .andExpect(jsonPath("$.loadAlert").value(nullValue()))
                .andExpect(jsonPath("$.participants[0].paceSecPerKm").value(321))
                .andExpect(jsonPath("$.participants[1].paceSecPerKm").value(379));
    }

    @Test
    void live_running_staleParticipant_hasNullPace_andIsNotCountedForLoadAlert()
            throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        long memberSession = joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        markStarted(memberSession);
        Instant now = Instant.now();
        // host 표본은 TTL 초과 -> stale. 빠르지만 부담 집계와 pace 노출에서 제외된다.
        insertSample(hostSession, now.minusSeconds(120), 1200.0, speedMpsForPace(300));
        insertSample(memberSession, now.minusSeconds(3), 1000.0, speedMpsForPace(400));

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupGuidePaceSecPerKm").value(350))
                .andExpect(jsonPath("$.loadAlert").value(nullValue()))
                .andExpect(jsonPath("$.participants[0].stale").value(true))
                .andExpect(jsonPath("$.participants[0].paceSecPerKm").value(nullValue()))
                .andExpect(jsonPath("$.participants[1].stale").value(false))
                .andExpect(jsonPath("$.participants[1].paceSecPerKm").value(400));
    }

    @Test
    void live_running_withoutMeasuredSpeed_hasNullPace() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        joinAndReady(groupRunId, memberId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        // 거리 표본만 있고 speed 없음 → 순위는 가능, 실측 페이스는 null
        insertSample(hostSession, Instant.now().minusSeconds(3), 500.0);

        live(groupRunId, memberId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.loadAlert").value(nullValue()))
                .andExpect(jsonPath("$.participants[0].stale").value(false))
                .andExpect(jsonPath("$.participants[0].paceSecPerKm").value(nullValue()));
    }

    @Test
    void live_completed_returnsNullRanks() throws Exception {
        long groupRunId = createGroupRun();
        long hostSession = readyHost(groupRunId);
        start(groupRunId, hostId).andExpect(status().isOk());
        markStarted(hostSession);
        insertSample(hostSession, Instant.now().minusSeconds(3), 800.0);
        forceFinish(groupRunId, hostId, "{}").andExpect(status().isOk());

        live(groupRunId, hostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.participants[0].rank").value(nullValue()))
                .andExpect(jsonPath("$.participants[0].progressM").value(nullValue()))
                .andExpect(jsonPath("$.participants[0].stale").value(true));
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

    private void insertSample(long sessionId, Instant measuredAt, double totalDistanceM) {
        insertSample(sessionId, measuredAt, totalDistanceM, null);
    }

    private void insertSample(
            long sessionId, Instant measuredAt, double totalDistanceM, Double speedMps) {
        jdbc.update(
                """
                INSERT INTO running_metric_samples(running_session_id, measured_at,
                    elapsed_duration, total_distance, speed, is_hr_measured)
                VALUES (?, ?, 100, ?, ?, FALSE)
                """,
                sessionId,
                Timestamp.from(measuredAt),
                totalDistanceM,
                speedMps);
    }

    private static double speedMpsForPace(int paceSecPerKm) {
        return 1000.0d / paceSecPerKm;
    }

    private void insertHeartRateSample(long sessionId, Instant measuredAt) {
        jdbc.update(
                """
                INSERT INTO running_metric_samples(running_session_id, measured_at,
                    elapsed_duration, heart_rate, is_hr_measured)
                VALUES (?, ?, 100, 120, TRUE)
                """,
                sessionId,
                Timestamp.from(measuredAt));
    }

    private void insertProfile(long userId, int averagePaceSecPerKm) {
        jdbc.update(
                """
                INSERT INTO user_profiles(user_id, running_level, average_pace, distance, duraction)
                VALUES (?, 'INTERMEDIATE'::user_profiles_running_level_enum, ?, 5000, 1800)
                """,
                userId,
                averagePaceSecPerKm);
    }

    private void insertCoachingDecision(long sessionId, int recommendedPaceSecPerKm) {
        jdbc.update(
                """
                INSERT INTO coaching_decisions(session_id, elapsed_duration, recommended_pace)
                VALUES (?, 60, ?)
                """,
                sessionId,
                recommendedPaceSecPerKm);
    }

    private static List<String> propertyNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.propertyNames().forEach(names::add);
        return names;
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
