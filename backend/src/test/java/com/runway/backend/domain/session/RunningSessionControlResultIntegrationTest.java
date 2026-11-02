package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S03~S06 RESULT — 작업 계획 AC-A2, AC-A3, AC-A6~AC-A8. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class RunningSessionControlResultIntegrationTest extends RunningSessionIntegrationSupport {

    private static final String T1 = "2026-10-28T01:00:01Z";
    private static final String T2 = "2026-10-28T01:30:00Z";

    private long approve(long sessionId, String path, long deviceId, long version) throws Exception {
        String json =
                mockMvc.perform(postControl(userId, sessionId, path, requestBody(deviceId, version)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return Long.parseLong(json.replaceAll(".*\"commandId\":(\\d+).*", "$1"));
    }

    private String commandState(long commandId) {
        return jdbc.queryForObject(
                "SELECT result::text || ':' || coalesce(to_char(applied_at AT TIME ZONE 'UTC',"
                        + " 'YYYY-MM-DD\"T\"HH24:MI:SS.US'),'') || ':' || coalesce(reason_code,'')"
                        + " FROM session_control_events WHERE id=?",
                String.class,
                commandId);
    }

    private String finishBody(long commandId, long deviceId, String appliedAt) {
        return resultBody(commandId, deviceId, "APPLIED", appliedAt)
                .replace("}", ",\"uploadComplete\":true}");
    }

    @Test
    void 시작_APPLIED가_RUNNING과_실제_시작시각을_확정한다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.persisted").value(true))
                .andExpect(jsonPath("$.stateVersion").value(2))
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.currentBpm").isEmpty())
                .andExpect(jsonPath("$.startedAt").value(T1))
                .andExpect(jsonPath("$.sessionId").value(sessionId))
                .andExpect(jsonPath("$.pendingCommand").isEmpty())
                .andExpect(jsonPath("$.lastCommand.result").value("APPLIED"));

        assertThat(commandState(commandId)).isEqualTo("APPLIED:2026-10-28T01:00:01.000000:");
        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @Test
    void 일시정지_재개_종료가_차례로_확정된다() throws Exception {
        long sessionId = insertReadySession();
        long start = approve(sessionId, "start", watchId, 1);
        mockMvc.perform(postControl(userId, sessionId, "start", resultBody(start, watchId, "APPLIED", T1)))
                .andExpect(status().isOk());

        long pause = approve(sessionId, "pause", watchId, 2);
        mockMvc.perform(postControl(userId, sessionId, "pause", resultBody(pause, watchId, "APPLIED", T1)))
                .andExpect(jsonPath("$.state").value("PAUSED"))
                .andExpect(jsonPath("$.stateVersion").value(3));
        long resume = approve(sessionId, "resume", watchId, 3);
        mockMvc.perform(
                        postControl(
                                userId, sessionId, "resume", resultBody(resume, watchId, "APPLIED", T1)))
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.stateVersion").value(4));
        long end = approve(sessionId, "finish", watchId, 4);
        mockMvc.perform(postControl(userId, sessionId, "finish", finishBody(end, watchId, T2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("COMPLETED"))
                .andExpect(jsonPath("$.stateVersion").value(5))
                .andExpect(jsonPath("$.endedAt").value(T2));

        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events WHERE session_id=? AND result='APPLIED'",
                                sessionId))
                .isEqualTo(4);
    }

    @Test
    void 같은_RESULT_재전송은_같은_응답이고_버전이_그대로다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);
        String body = resultBody(commandId, watchId, "APPLIED", T1);
        mockMvc.perform(postControl(userId, sessionId, "start", body)).andExpect(status().isOk());

        mockMvc.perform(postControl(userId, sessionId, "start", body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.stateVersion").value(2));

        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @Test
    void 적용시각_표기만_다른_재전송은_같은_결과다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);
        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        postControl(
                                userId,
                                sessionId,
                                "start",
                                resultBody(commandId, watchId, "APPLIED", "2026-10-28T01:00:01.000000Z")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateVersion").value(2));
    }

    @Test
    void 다른_확정_결과는_COMMAND_CONFLICT() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);
        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "REJECTED", null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_CONFLICT"));
        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_CONFLICT"));

        assertThat(stateVersion(sessionId)).isEqualTo(2);
        assertThat(commandState(commandId)).startsWith("APPLIED:2026-10-28T01:00:01");
    }

    @Test
    void 확정_후_UNKNOWN_보고는_기존_결과를_반환한다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);
        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "UNKNOWN", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.stateVersion").value(2));

        assertThat(commandState(commandId)).startsWith("APPLIED:");
    }

    @Test
    void REJECTED는_상태를_유지하고_버전을_올린다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);

        mockMvc.perform(
                        postControl(
                                userId,
                                sessionId,
                                "start",
                                resultBody(commandId, watchId, "REJECTED", null)
                                        .replace("\"reasonCode\":null", "\"reasonCode\":\"VERSION_MISMATCH\"")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("REJECTED"))
                .andExpect(jsonPath("$.state").value("READY"))
                .andExpect(jsonPath("$.stateVersion").value(2))
                .andExpect(jsonPath("$.pendingCommand").isEmpty());

        assertThat(commandState(commandId)).isEqualTo("REJECTED::VERSION_MISMATCH");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT started_at FROM running_sessions WHERE id=?", Object.class, sessionId))
                .isNull();
    }

    @Test
    void UNKNOWN은_상태와_버전을_유지하고_다음_승인을_막는다() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);

        mockMvc.perform(
                        postControl(
                                userId,
                                sessionId,
                                "start",
                                resultBody(commandId, watchId, "UNKNOWN", null)
                                        .replace("\"reasonCode\":null", "\"reasonCode\":\"EXERCISE_CALL_TIMEOUT\"")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UNKNOWN"))
                .andExpect(jsonPath("$.state").value("READY"))
                .andExpect(jsonPath("$.stateVersion").value(1))
                .andExpect(jsonPath("$.pendingCommand.result").value("UNKNOWN"));

        // 버전이 그대로이므로 같은 슬롯 재전송은 새 명령 없이 저장된 UNKNOWN을, 다른 작업은 COMMAND_CONFLICT를 받는다(A-1/B-1).
        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("UNKNOWN"));
        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));
        assertThat(commandCount(sessionId)).isEqualTo(1);

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.stateVersion").value(2));
    }

    @Test
    void 폰_인계_후_이전_워치의_결과는_CONTROL_DEVICE_CHANGED() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, watchId, phoneId, "PENDING", null);
        long commandId = approve(sessionId, "pause", watchId, 5);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"TAKE_OVER_PHONE\",\"deviceId\":" + phoneId
                                        + ",\"expectedVersion\":5,\"receivedWatchBatchesUploaded\":true}"))
                .andExpect(status().isOk());

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "pause", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_DEVICE_CHANGED"));

        assertThat(commandState(commandId)).isEqualTo("UNKNOWN::WATCH_DISCONNECTED");
        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
        assertThat(stateVersion(sessionId)).isEqualTo(6);
    }

    /** 2026-11-02 결정: 이미 저장된 같은 결과의 재전송은 인계 뒤에도 기존 응답을 돌려준다(응답 유실 복구). */
    @Test
    void 인계_뒤_이미_저장된_같은_결과의_재전송은_기존_응답() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, watchId, phoneId, "PENDING", null);
        long commandId = approve(sessionId, "pause", watchId, 5);
        String body = resultBody(commandId, watchId, "APPLIED", T1);
        mockMvc.perform(postControl(userId, sessionId, "pause", body)).andExpect(status().isOk());
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"TAKE_OVER_PHONE\",\"deviceId\":" + phoneId
                                        + ",\"expectedVersion\":6,\"receivedWatchBatchesUploaded\":true}"))
                .andExpect(status().isOk());

        mockMvc.perform(postControl(userId, sessionId, "pause", body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.persisted").value(true))
                .andExpect(jsonPath("$.stateVersion").value(7));

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "pause", resultBody(commandId, watchId, "REJECTED", null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_DEVICE_CHANGED"));
        assertThat(stateVersion(sessionId)).isEqualTo(7);
    }

    @Test
    void 워치_연결_해제_뒤_이미_저장된_같은_결과의_재전송은_기존_응답() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        long commandId = approve(sessionId, "pause", watchId, 2);
        String body = resultBody(commandId, watchId, "APPLIED", T1);
        mockMvc.perform(postControl(userId, sessionId, "pause", body)).andExpect(status().isOk());
        jdbc.update("UPDATE user_devices SET unlinked_at = now() WHERE id=?", watchId);

        mockMvc.perform(postControl(userId, sessionId, "pause", body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.stateVersion").value(3));
    }

    /** A-4: 워치 단절 후 폰이 실행기기가 되어 직접 실행·보고하는 경로. */
    @Test
    void 폰_인계_후_폰의_결과로_일시정지와_종료가_확정된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, phoneId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = TIMESTAMPTZ '2026-10-28T00:00:00Z' WHERE id=?",
                sessionId);
        long pause = approve(sessionId, "pause", phoneId, 5);

        mockMvc.perform(postControl(userId, sessionId, "pause", resultBody(pause, phoneId, "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("PAUSED"))
                .andExpect(jsonPath("$.stateVersion").value(6))
                .andExpect(jsonPath("$.recordingMode").value("PHONE_FALLBACK"));

        long end = approve(sessionId, "finish", phoneId, 6);
        mockMvc.perform(postControl(userId, sessionId, "finish", finishBody(end, phoneId, T2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("COMPLETED"))
                .andExpect(jsonPath("$.endedAt").value(T2));
    }

    @Test
    void 관리상_중단된_세션의_늦은_시작_결과는_INVALID_SESSION_STATE() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"ABORT_UNCONFIRMED_START\",\"deviceId\":" + phoneId
                                        + ",\"expectedVersion\":1}"))
                .andExpect(status().isOk());

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        assertThat(sessionStatus(sessionId)).isEqualTo("INTERRUPTED");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT started_at FROM running_sessions WHERE id=?", Object.class, sessionId))
                .isNull();
    }

    @Test
    void 연결_해제된_워치의_결과는_DEVICE_FORBIDDEN() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        long commandId = approve(sessionId, "pause", watchId, 2);
        jdbc.update("UPDATE user_devices SET unlinked_at = now() WHERE id=?", watchId);

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "pause", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));

        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
        assertThat(commandState(commandId)).isEqualTo("PENDING::");
    }

    @Test
    void 다른_작업의_명령번호는_COMMAND_NOT_FOUND() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "pause", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMAND_NOT_FOUND"));
        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(999999, watchId, "APPLIED", T1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMAND_NOT_FOUND"));
    }

    @Test
    void 다른_세션의_명령번호는_COMMAND_NOT_FOUND() throws Exception {
        long first = insertReadySession();
        long commandId = approve(first, "start", watchId, 1);
        jdbc.update("UPDATE running_sessions SET status='CANCELLED' WHERE id=?", first);
        long second = insertReadySession();

        mockMvc.perform(postControl(userId, second, "start", resultBody(commandId, watchId, "APPLIED", T1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMAND_NOT_FOUND"));
    }

    @Test
    void 명령_기기와_다른_deviceId는_DEVICE_FORBIDDEN() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "start", resultBody(commandId, phoneId, "APPLIED", T1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));

        assertThat(commandState(commandId)).isEqualTo("PENDING::");
    }

    @Test
    void 타인_세션의_결과_보고는_SESSION_FORBIDDEN() throws Exception {
        long sessionId = insertReadySession();
        long commandId = approve(sessionId, "start", watchId, 1);

        mockMvc.perform(
                        postControl(
                                otherUserId,
                                sessionId,
                                "start",
                                resultBody(commandId, otherWatchId, "APPLIED", T1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SESSION_FORBIDDEN"));
    }
}
