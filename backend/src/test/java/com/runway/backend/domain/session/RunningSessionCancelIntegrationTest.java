package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S07 준비 취소 — 작업 계획 AC-A11. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class RunningSessionCancelIntegrationTest extends RunningSessionIntegrationSupport {

    @Test
    void 준비_세션_취소는_CANCELLED와_버전_증가() throws Exception {
        long sessionId = insertReadySession();

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"id\":" + sessionId + ",\"status\":\"CANCELLED\"}", true));

        assertThat(sessionStatus(sessionId)).isEqualTo("CANCELLED");
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @Test
    void 취소_재요청은_같은_결과이고_버전이_그대로다() throws Exception {
        long sessionId = insertReadySession();
        mockMvc.perform(cancelRequest(userId, sessionId)).andExpect(status().isOk());

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @Test
    void 대기_중인_시작이_있으면_COMMAND_PENDING() throws Exception {
        long sessionId = insertReadySession();
        insertCommand(sessionId, watchId, "START", 1, "PENDING");

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_PENDING"));

        assertThat(sessionStatus(sessionId)).isEqualTo("READY");
        assertThat(stateVersion(sessionId)).isEqualTo(1);
    }

    @Test
    void 미확인_시작이_있어도_COMMAND_PENDING() throws Exception {
        long sessionId = insertReadySession();
        insertCommand(sessionId, watchId, "START", 1, "UNKNOWN");

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_PENDING"));

        assertThat(sessionStatus(sessionId)).isEqualTo("READY");
    }

    @Test
    void 운동_중이면_INVALID_STATE() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));

        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
    }

    /** B-5: V1 기존 세션(stateVersion=0)은 상태를 바꿀 수 없어 legacy 구분을 유지한다. */
    @Test
    void 기존_기록_세션은_취소하지_않는다() throws Exception {
        long sessionId = insertSession(userId, "READY", 0, null, null, "LEGACY", null);

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));

        assertThat(stateVersion(sessionId)).isZero();
        assertThat(sessionStatus(sessionId)).isEqualTo("READY");
    }

    @Test
    void 타인_세션은_FORBIDDEN이고_상태를_노출하지_않는다() throws Exception {
        long sessionId = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.status").doesNotExist());

        assertThat(sessionStatus(sessionId)).isEqualTo("READY");
    }

    @Test
    void 삭제된_세션은_SESSION_NOT_FOUND() throws Exception {
        long sessionId = insertReadySession();
        jdbc.update("UPDATE running_sessions SET deleted_at = now() WHERE id=?", sessionId);

        mockMvc.perform(cancelRequest(userId, sessionId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
    }

    @Test
    void 취소_뒤_시작_요청은_INVALID_SESSION_STATE() throws Exception {
        long sessionId = insertReadySession();
        mockMvc.perform(cancelRequest(userId, sessionId)).andExpect(status().isOk());

        mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }
}
