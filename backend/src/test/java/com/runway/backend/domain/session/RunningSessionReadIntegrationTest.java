package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S02 — AC-7, AC-8. 명령·코칭·그룹 행은 생성 API가 아직 없어 직접 넣는다. */
@Testcontainers
class RunningSessionReadIntegrationTest extends RunningSessionIntegrationSupport {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void 본인_세션을_조회하고_서버시각을_함께_준다() throws Exception {
        long sessionId = insertReadySession();
        String body =
                mockMvc.perform(getRequest(userId, sessionId))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.sessionId").value(sessionId))
                        .andExpect(jsonPath("$.state").value("READY"))
                        .andExpect(jsonPath("$.stateVersion").value(1))
                        .andExpect(jsonPath("$.recordingMode").value("WATCH"))
                        .andExpect(jsonPath("$.coaching").value(nullValue()))
                        .andExpect(jsonPath("$.movingDurationSec").value(nullValue()))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        JsonNode node = JSON.readTree(body);
        Instant receive = Instant.parse(node.get("serverReceiveAt").stringValue());
        Instant send = Instant.parse(node.get("serverSendAt").stringValue());
        assertThat(receive).isBeforeOrEqualTo(send);
    }

    @Test
    void 시작_전_세션의_movingDurationSec는_null이다() throws Exception {
        long sessionId = insertReadySession();
        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.startedAt").value(nullValue()))
                .andExpect(jsonPath("$.movingDurationSec").value(nullValue()));
    }

    @Test
    void RUNNING_세션은_일시정지를_제외한_movingDurationSec를_준다() throws Exception {
        Instant started = Instant.parse("2026-10-28T01:00:00Z");
        long sessionId = insertSession(userId, "RUNNING", 3, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = ? WHERE id=?",
                java.sql.Timestamp.from(started),
                sessionId);
        insertAppliedCommand(sessionId, watchId, "PAUSE", 2, Instant.parse("2026-10-28T01:05:00Z"));
        insertAppliedCommand(sessionId, watchId, "RESUME", 3, Instant.parse("2026-10-28T01:06:40Z"));

        String body =
                mockMvc.perform(getRequest(userId, sessionId))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        JsonNode node = JSON.readTree(body);
        Instant send = Instant.parse(node.get("serverSendAt").stringValue());
        int expected =
                PostRunAnalysisCalculator.movingDurationSec(
                        started,
                        send,
                        List.of(
                                new PauseResumeEvent(
                                        ControlAction.PAUSE, Instant.parse("2026-10-28T01:05:00Z")),
                                new PauseResumeEvent(
                                        ControlAction.RESUME,
                                        Instant.parse("2026-10-28T01:06:40Z"))));
        assertThat(node.get("movingDurationSec").intValue()).isEqualTo(expected);
    }

    @Test
    void PAUSED_세션은_열린_PAUSE를_serverSendAt까지_뺀다() throws Exception {
        Instant started = Instant.parse("2026-10-28T01:00:00Z");
        Instant pausedAt = Instant.parse("2026-10-28T01:03:00Z");
        long sessionId = insertSession(userId, "PAUSED", 4, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = ? WHERE id=?",
                java.sql.Timestamp.from(started),
                sessionId);
        insertAppliedCommand(sessionId, watchId, "PAUSE", 4, pausedAt);

        String body =
                mockMvc.perform(getRequest(userId, sessionId))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        JsonNode node = JSON.readTree(body);
        Instant send = Instant.parse(node.get("serverSendAt").stringValue());
        int expected =
                PostRunAnalysisCalculator.movingDurationSec(
                        started, send, List.of(new PauseResumeEvent(ControlAction.PAUSE, pausedAt)));
        assertThat(node.get("movingDurationSec").intValue()).isEqualTo(expected);
        assertThat(expected).isEqualTo(180);
    }

    @Test
    void 종료_세션의_movingDurationSec는_endedAt_기준_이벤트_재계산이며_저장_컬럼과_무관하다()
            throws Exception {
        // AC-6: S02는 moving_duration 컬럼을 읽지 않고, 분석과 같은 calculator 입력으로 재계산한다.
        // 저장 컬럼을 고의로 어긋나게 두어도 S02는 이벤트 기준 540을 반환해야 한다(리뷰 B-1).
        Instant started = Instant.parse("2026-10-28T01:00:00Z");
        Instant ended = Instant.parse("2026-10-28T01:10:00Z");
        Instant pauseAt = Instant.parse("2026-10-28T01:04:00Z");
        Instant resumeAt = Instant.parse("2026-10-28T01:05:00Z");
        long sessionId = insertSession(userId, "COMPLETED", 6, watchId, phoneId, "READY", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = ?, ended_at = ?, moving_duration = ? WHERE id=?",
                java.sql.Timestamp.from(started),
                java.sql.Timestamp.from(ended),
                999,
                sessionId);
        insertAppliedCommand(sessionId, watchId, "PAUSE", 4, pauseAt);
        insertAppliedCommand(sessionId, watchId, "RESUME", 5, resumeAt);

        List<PauseResumeEvent> events =
                List.of(
                        new PauseResumeEvent(ControlAction.PAUSE, pauseAt),
                        new PauseResumeEvent(ControlAction.RESUME, resumeAt));
        int expected = PostRunAnalysisCalculator.movingDurationSec(started, ended, events);
        assertThat(expected).isEqualTo(540);
        assertThat(
                        PostRunAnalysisCalculator.calculate(
                                        started,
                                        ended,
                                        null,
                                        null,
                                        List.of(),
                                        events)
                                .stats()
                                .movingDuration())
                .isEqualTo(expected);

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movingDurationSec").value(540));
        Integer stored =
                jdbc.queryForObject(
                        "SELECT moving_duration FROM running_sessions WHERE id=?",
                        Integer.class,
                        sessionId);
        assertThat(stored).isEqualTo(999);
    }

    @Test
    void 타인_없는_삭제된_세션과_잘못된_ID를_구분한다() throws Exception {
        long others = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);
        long deleted = insertSession(userId, "CANCELLED", 2, watchId, phoneId, "PENDING", null);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);

        mockMvc.perform(getRequest(userId, others))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SESSION_FORBIDDEN"));
        mockMvc.perform(getRequest(userId, 999999))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        mockMvc.perform(getRequest(userId, deleted))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        for (String bad : new String[] {"0", "-1", "abc", "1.5", "99999999999999999999"}) {
            mockMvc.perform(getRequest(userId, bad))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mockMvc.perform(get("/api/v1/running-sessions/" + others)).andExpect(status().isUnauthorized());
    }

    @Test
    void 워치_대기_START는_pendingCommand와_lastCommand로_보인다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = insertCommand(sessionId, watchId, "START", 1, "PENDING");

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pendingCommand.commandId").value(commandId))
                .andExpect(jsonPath("$.pendingCommand.action").value("START"))
                .andExpect(jsonPath("$.pendingCommand.targetBpm").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.expectedVersion").value(1))
                .andExpect(jsonPath("$.pendingCommand.coachingId").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.result").value("PENDING"))
                .andExpect(jsonPath("$.pendingCommand.appliedAt").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.reasonCode").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide").value(nullValue()))
                .andExpect(jsonPath("$.lastCommand.commandId").value(commandId));
    }

    @Test
    void 폰_인계_후에는_현재_폰_명령만_pending이고_워치_UNKNOWN은_이력이다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, phoneId, phoneId, "PENDING", null);
        insertCommand(sessionId, watchId, "PAUSE", 3, "UNKNOWN");
        long phoneCommand = insertCommand(sessionId, phoneId, "PAUSE", 5, "PENDING");

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(jsonPath("$.recordingMode").value("PHONE_FALLBACK"))
                .andExpect(jsonPath("$.pendingCommand.commandId").value(phoneCommand))
                .andExpect(jsonPath("$.lastCommand.commandId").value(phoneCommand));
    }

    @Test
    void 관리상_중단된_세션은_pending이_없고_보존된_START는_lastCommand다() throws Exception {
        long sessionId = insertSession(userId, "INTERRUPTED", 2, watchId, phoneId, "FAILED", null);
        long start = insertCommand(sessionId, watchId, "START", 1, "UNKNOWN");

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(jsonPath("$.state").value("INTERRUPTED"))
                .andExpect(jsonPath("$.pendingCommand").value(nullValue()))
                .andExpect(jsonPath("$.lastCommand.commandId").value(start))
                .andExpect(jsonPath("$.lastCommand.result").value("UNKNOWN"));
    }

    @Test
    void 만료된_미확인_코칭은_coaching_null이고_coachingGuide로_확인한다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 3, watchId, phoneId, "PENDING", null);
        long coachingId =
                jdbc.queryForObject(
                        """
                        INSERT INTO coaching_decisions(session_id,elapsed_duration,recommended_pace,cue_bpm,
                                                       based_on_state_version,expires_at,created_at)
                        VALUES (?,60,360.00,165,3,TIMESTAMPTZ '2026-10-29T01:00:20Z',TIMESTAMPTZ '2026-10-29T01:00:05Z')
                        RETURNING id
                        """,
                        Long.class,
                        sessionId);
        long commandId =
                jdbc.queryForObject(
                        """
                        INSERT INTO session_control_events(session_id,device_id,action,target_bpm,expected_version,coaching_id,result)
                        VALUES (?,?,'COACHING',165,3,?,'PENDING') RETURNING id
                        """,
                        Long.class,
                        sessionId,
                        watchId,
                        coachingId);

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(jsonPath("$.coaching").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.action").value("COACHING"))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.commandId").value(commandId))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.coachingId").value(coachingId))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.expectedVersion").value(3))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.targetBpm").value(165))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.recommendedPaceSecPerKm").value(360.0))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.expiresAt").value("2026-10-29T01:00:20Z"))
                // 마지막 명령이 같은 미확정 COACHING이면 같은 가이드를 보여준다(sessions.md 명령 객체 coachingGuide).
                .andExpect(jsonPath("$.lastCommand.commandId").value(commandId))
                .andExpect(jsonPath("$.lastCommand.coachingGuide.commandId").value(commandId))
                .andExpect(jsonPath("$.lastCommand.coachingGuide.coachingId").value(coachingId));
    }

    @Test
    void 기기정보_없는_기존기록은_recordingMode_null이고_LEGACY다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 0, null, null, "LEGACY", null);

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(jsonPath("$.stateVersion").value(0))
                .andExpect(jsonPath("$.recordingMode").value(nullValue()))
                .andExpect(jsonPath("$.controlDeviceId").value(nullValue()))
                .andExpect(jsonPath("$.analysis.status").value("LEGACY"))
                .andExpect(jsonPath("$.pendingCommand").value(nullValue()));
    }

    @Test
    void 종료된_그룹런이면_groupEndedAt을_준다() throws Exception {
        long ended = insertSession(userId, "COMPLETED", 4, watchId, phoneId, "READY", null);
        joinGroup(insertGroupRun("COMPLETED", true), userId, ended);
        long running = insertSession(otherUserId, "RUNNING", 2, otherWatchId, otherPhoneId, "PENDING", null);
        joinGroup(insertGroupRun("RUNNING", false), otherUserId, running);

        mockMvc.perform(getRequest(userId, ended))
                .andExpect(jsonPath("$.groupEndedAt").value("2026-10-29T01:00:00Z"));
        mockMvc.perform(getRequest(otherUserId, running))
                .andExpect(jsonPath("$.groupEndedAt").value(nullValue()));
    }
}
