package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.session.service.PostRunAnalysisDispatcher;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S06 종료 저장 확인과 종료 이벤트 — 작업 계획 AC-A9. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
@Import(EndedEventRecorder.class)
class RunningSessionFinishIntegrationTest extends RunningSessionIntegrationSupport {

    private static final String ENDED = "2026-10-28T01:30:00Z";

    @Autowired private EndedEventRecorder recorder;
    @Autowired private PostRunAnalysisDispatcher analysisDispatcher;

    @BeforeEach
    void clearEvents() throws InterruptedException {
        assertThat(analysisDispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
        recorder.clear();
    }

    /** 종료 확정 후 비동기 분석이 끝날 때까지 기다린다(S15P31E105-312). */
    private void awaitPostRunAnalysis() throws InterruptedException {
        assertThat(analysisDispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
    }

    private long approveEnd(long sessionId, long version) throws Exception {
        String json =
                mockMvc.perform(postControl(userId, sessionId, "finish", requestBody(watchId, version)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return Long.parseLong(json.replaceAll(".*\"commandId\":([0-9]+).*", "$1"));
    }

    private String applied(long commandId, String uploadComplete) {
        String body = resultBody(commandId, watchId, "APPLIED", ENDED);
        return uploadComplete == null ? body : body.replace("}", ",\"uploadComplete\":" + uploadComplete + "}");
    }

    /** 실제 시작시각은 종료시각(ENDED)보다 앞선 고정값으로 둔다. */
    private long runningSession() {
        long sessionId = insertSession(userId, "RUNNING", 4, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = TIMESTAMPTZ '2026-10-28T01:00:00Z' WHERE id=?",
                sessionId);
        return sessionId;
    }

    @Test
    void 저장_확인이_false면_UPLOAD_PENDING이고_아무것도_저장하지_않는다() throws Exception {
        long sessionId = runningSession();
        long commandId = approveEnd(sessionId, 4);

        mockMvc.perform(postControl(userId, sessionId, "finish", applied(commandId, "false")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("UPLOAD_PENDING"));

        assertThat(count("SELECT count(*) FROM session_control_events WHERE id=? AND result='PENDING'", commandId))
                .isEqualTo(1);
        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
        assertThat(stateVersion(sessionId)).isEqualTo(4);
        assertThat(recorder.events()).isEmpty();
    }

    @Test
    void 저장_확인을_생략해도_UPLOAD_PENDING() throws Exception {
        long sessionId = runningSession();
        long commandId = approveEnd(sessionId, 4);

        mockMvc.perform(postControl(userId, sessionId, "finish", applied(commandId, null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("UPLOAD_PENDING"));

        assertThat(recorder.events()).isEmpty();
    }

    @Test
    void 저장_확인이_true면_종료가_확정되고_종료_이벤트가_한번_나간다() throws Exception {
        long sessionId = runningSession();
        long commandId = approveEnd(sessionId, 4);

        // 종료 응답은 같은 트랜잭션 스냅샷이라 PENDING·version=5. 분석은 AFTER_COMMIT 비동기.
        mockMvc.perform(postControl(userId, sessionId, "finish", applied(commandId, "true")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("COMPLETED"))
                .andExpect(jsonPath("$.stateVersion").value(5))
                .andExpect(jsonPath("$.endedAt").value(ENDED))
                .andExpect(jsonPath("$.analysis.status").value("PENDING"));

        awaitPostRunAnalysis();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT analysis_status::text FROM running_sessions WHERE id=?",
                                String.class,
                                sessionId))
                .isEqualTo("READY");
        assertThat(stateVersion(sessionId)).isEqualTo(6);
        assertThat(recorder.events()).hasSize(1);
        assertThat(recorder.events().get(0).sessionId()).isEqualTo(sessionId);
        assertThat(recorder.events().get(0).endedAt()).isEqualTo(Instant.parse(ENDED));
        assertThat(recorder.events().get(0).groupRunId()).isNull();
    }

    /** 2026-11-02 확정: 실제 종료시각은 실제 시작시각보다 늦어야 한다(같은 시각 포함 거절). */
    @Test
    void 시작보다_늦지_않은_종료시각은_VALIDATION_ERROR이고_저장하지_않는다() throws Exception {
        long sessionId = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET started_at = TIMESTAMPTZ '2026-10-28T01:30:00Z' WHERE id=?",
                sessionId);
        long commandId = approveEnd(sessionId, 4);

        for (String endedAt : new String[] {"2026-10-28T01:29:59Z", "2026-10-28T01:30:00Z"}) {
            String body =
                    resultBody(commandId, watchId, "APPLIED", endedAt)
                            .replace("}", ",\"uploadComplete\":true}");
            mockMvc.perform(postControl(userId, sessionId, "finish", body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }

        assertThat(count("SELECT count(*) FROM session_control_events WHERE id=? AND result='PENDING'", commandId))
                .isEqualTo(1);
        assertThat(sessionStatus(sessionId)).isEqualTo("RUNNING");
        assertThat(stateVersion(sessionId)).isEqualTo(4);
        assertThat(recorder.events()).isEmpty();
    }

    @Test
    void 종료_결과_재전송은_이벤트를_다시_보내지_않는다() throws Exception {
        long sessionId = runningSession();
        long commandId = approveEnd(sessionId, 4);
        mockMvc.perform(postControl(userId, sessionId, "finish", applied(commandId, "true")))
                .andExpect(status().isOk());
        awaitPostRunAnalysis();

        // 분석으로 version=6이 된 뒤 재전송해도 이벤트는 1회, 버전은 더 오르지 않는다.
        mockMvc.perform(postControl(userId, sessionId, "finish", applied(commandId, "true")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateVersion").value(6));

        assertThat(recorder.events()).hasSize(1);
    }

    @Test
    void 종료_거절은_상태를_유지하고_이벤트가_없다() throws Exception {
        long sessionId = runningSession();
        long commandId = approveEnd(sessionId, 4);

        mockMvc.perform(
                        postControl(
                                userId, sessionId, "finish", resultBody(commandId, watchId, "REJECTED", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.stateVersion").value(5));

        assertThat(recorder.events()).isEmpty();
    }

    @Test
    void 그룹_세션_종료_이벤트는_그룹을_포함한다() throws Exception {
        long sessionId = runningSession();
        long groupRunId = insertGroupRun("RUNNING", false);
        joinGroup(groupRunId, userId, sessionId);
        long commandId = approveEnd(sessionId, 4);

        mockMvc.perform(postControl(userId, sessionId, "finish", applied(commandId, "true")))
                .andExpect(status().isOk());

        assertThat(recorder.events()).hasSize(1);
        assertThat(recorder.events().get(0).groupRunId()).isEqualTo(groupRunId);
    }
}
