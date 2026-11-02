package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S03~S06 REQUEST — 작업 계획 AC-A1, AC-A4, AC-A5, AC-A10. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class RunningSessionControlRequestIntegrationTest extends RunningSessionIntegrationSupport {

    private long commandIdOf(String json) {
        return Long.parseLong(json.replaceAll(".*\"commandId\":(\\d+).*", "$1"));
    }

    @Test
    void 시작_승인은_PENDING이고_세션은_그대로다() throws Exception {
        long sessionId = insertReadySession();

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").isNumber())
                .andExpect(jsonPath("$.action").value("START"))
                .andExpect(jsonPath("$.expectedVersion").value(1))
                .andExpect(jsonPath("$.targetBpm").isEmpty())
                .andExpect(jsonPath("$.coachingId").isEmpty())
                .andExpect(jsonPath("$.result").value("PENDING"));

        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events WHERE session_id=? AND action='START'"
                                        + " AND result='PENDING' AND device_id=? AND expected_version=1",
                                sessionId,
                                watchId))
                .isEqualTo(1);
        assertThat(sessionStatus(sessionId)).isEqualTo("READY");
        assertThat(stateVersion(sessionId)).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT started_at FROM running_sessions WHERE id=?", Object.class, sessionId))
                .isNull();
    }

    @Test
    void 같은_REQUEST_재전송은_같은_commandId() throws Exception {
        long sessionId = insertReadySession();
        String first =
                mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandIdOf(first)))
                .andExpect(jsonPath("$.result").value("PENDING"));

        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 거절된_슬롯의_REQUEST_재전송은_저장된_REJECTED를_반환() throws Exception {
        long sessionId = insertSession(userId, "READY", 2, watchId, phoneId, "PENDING", null);
        long commandId = insertCommand(sessionId, watchId, "START", 1, "REJECTED");

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("REJECTED"));

        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 같은_슬롯의_다른_action은_COMMAND_CONFLICT() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        insertCommand(sessionId, watchId, "PAUSE", 2, "PENDING");

        mockMvc.perform(postControl(userId, sessionId, "finish", requestBody(watchId, 2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_CONFLICT"));

        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 미확정_명령이_있으면_COMMAND_PENDING() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 3, watchId, phoneId, "PENDING", null);
        insertCommand(sessionId, watchId, "PAUSE", 2, "UNKNOWN");

        mockMvc.perform(postControl(userId, sessionId, "pause", requestBody(watchId, 3)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_PENDING"));

        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 준비_상태의_일시정지는_INVALID_SESSION_STATE() throws Exception {
        long sessionId = insertReadySession();

        mockMvc.perform(postControl(userId, sessionId, "pause", requestBody(watchId, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 운동_중_시작은_INVALID_SESSION_STATE() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    /** S07 "뒤의 새 START는 상태 검사로 거절한다". 끝난 세션은 버전과 관계없이 승인할 수 없다. */
    @Test
    void 끝난_세션은_오래된_버전이어도_INVALID_SESSION_STATE() throws Exception {
        long cancelled = insertSession(userId, "CANCELLED", 2, watchId, phoneId, "PENDING", null);
        long completed = insertSession(userId, "COMPLETED", 5, watchId, phoneId, "PENDING", null);

        mockMvc.perform(postControl(userId, cancelled, "start", requestBody(watchId, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        mockMvc.perform(postControl(userId, completed, "finish", requestBody(watchId, 4)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @Test
    void 기준_버전이_다르면_STALE_STATE() throws Exception {
        long sessionId = insertReadySession();

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));

        assertThat(commandCount(sessionId)).isZero();
        assertThat(stateVersion(sessionId)).isEqualTo(1);
    }

    @Test
    void 제어기기가_아닌_본인_기기는_DEVICE_FORBIDDEN() throws Exception {
        long sessionId = insertReadySession();

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(phoneId, 1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));

        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 연결_해제된_제어_워치는_DEVICE_FORBIDDEN() throws Exception {
        long sessionId = insertReadySession();
        jdbc.update("UPDATE user_devices SET unlinked_at = now() WHERE id=?", watchId);

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
    }

    @Test
    void 타인_세션은_SESSION_FORBIDDEN이고_상태를_노출하지_않는다() throws Exception {
        long sessionId = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SESSION_FORBIDDEN"))
                .andExpect(jsonPath("$.commandId").doesNotExist())
                .andExpect(jsonPath("$.state").doesNotExist());

        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 없는_세션은_SESSION_NOT_FOUND() throws Exception {
        mockMvc.perform(postControl(userId, 999999, "start", requestBody(watchId, 1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
    }

    @Test
    void 빈_본문은_VALIDATION_ERROR() throws Exception {
        long sessionId = insertReadySession();

        mockMvc.perform(postControl(userId, sessionId, "start", "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 그룹_연결_세션의_시작은_INVALID_SESSION_STATE() throws Exception {
        long sessionId = insertReadySession();
        joinGroup(insertGroupRun("SCHEDULED", false), userId, sessionId);

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 병합된_코스_세션의_시작은_COURSE_INACCESSIBLE() throws Exception {
        long course = insertCourse("MERGED", "5000");
        long sessionId = insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", course);

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COURSE_INACCESSIBLE"));
    }

    @Test
    void 폰_인계_후_폰은_일시정지와_종료를_승인받고_시작은_거절된다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, phoneId, phoneId, "PENDING", null);

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(phoneId, 5)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        mockMvc.perform(postControl(userId, sessionId, "pause", requestBody(phoneId, 5)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("PAUSE"))
                .andExpect(jsonPath("$.result").value("PENDING"));

        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events WHERE session_id=? AND device_id=?",
                                sessionId,
                                phoneId))
                .isEqualTo(1);
    }

    @Test
    void 폰_인계_후_종료_승인() throws Exception {
        long sessionId = insertSession(userId, "PAUSED", 5, phoneId, phoneId, "PENDING", null);

        mockMvc.perform(postControl(userId, sessionId, "finish", requestBody(phoneId, 5)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("END"));
    }

    /** A-2/B-4: 공통 계약 "그룹이 종료됐다면 END만 허용한다". */
    @Test
    void 그룹이_종료된_운동_중_세션은_일시정지를_거절한다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, phoneId, phoneId, "PENDING", null);
        joinGroup(insertGroupRun("COMPLETED", true), userId, sessionId);

        mockMvc.perform(postControl(userId, sessionId, "pause", requestBody(phoneId, 5)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 그룹이_종료된_일시정지_세션은_재개를_거절하고_종료는_승인한다() throws Exception {
        long sessionId = insertSession(userId, "PAUSED", 3, watchId, phoneId, "PENDING", null);
        joinGroup(insertGroupRun("COMPLETED", true), userId, sessionId);

        mockMvc.perform(postControl(userId, sessionId, "resume", requestBody(watchId, 3)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        mockMvc.perform(postControl(userId, sessionId, "finish", requestBody(watchId, 3)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("END"))
                .andExpect(jsonPath("$.result").value("PENDING"));
    }
}
