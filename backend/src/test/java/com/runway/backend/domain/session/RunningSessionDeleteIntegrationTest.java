package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

/** S09 — AC-17, AC-18. */
@Testcontainers
class RunningSessionDeleteIntegrationTest extends RunningSessionIntegrationSupport {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private boolean deleted(long sessionId) {
        return jdbc.queryForObject(
                "SELECT deleted_at IS NOT NULL FROM running_sessions WHERE id=?", Boolean.class, sessionId);
    }

    private Instant postDeletedAt(long postId) {
        Timestamp value =
                jdbc.queryForObject("SELECT deleted_at FROM posts WHERE id=?", Timestamp.class, postId);
        return value == null ? null : value.toInstant();
    }

    @Test
    void 삭제_가능한_상태는_200이고_상태와_버전은_그대로다() throws Exception {
        long cancelled = insertSession(userId, "CANCELLED", 2, watchId, phoneId, "PENDING", null);
        long completedReady = insertSession(userId, "COMPLETED", 7, watchId, phoneId, "READY", null);
        long completedFailed = insertSession(userId, "COMPLETED", 7, watchId, phoneId, "FAILED", null);
        long legacy = insertSession(userId, "COMPLETED", 0, null, null, "LEGACY", null);
        long interrupted = insertSession(userId, "INTERRUPTED", 2, watchId, phoneId, "FAILED", null);
        insertCommand(interrupted, watchId, "START", 1, "UNKNOWN");

        for (long id : new long[] {cancelled, completedReady, completedFailed, legacy, interrupted}) {
            long before = stateVersion(id);
            mockMvc.perform(deleteRequest(userId, id))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(id))
                    .andExpect(jsonPath("$.deletedAt").isString());
            assertThat(deleted(id)).isTrue();
            assertThat(stateVersion(id)).isEqualTo(before);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status::text FROM running_sessions WHERE id=?",
                                String.class,
                                interrupted))
                .isEqualTo("INTERRUPTED");
    }

    /** S15P31E105-599 S09 5항, 리뷰 A-7: 삭제 API가 커밋 후 그 러닝의 운동 부하를 지우고 일별 부하를 비운다. */
    @Autowired
    private com.runway.backend.domain.readiness.trainingload.TrainingLoadDispatcher trainingLoadDispatcher;

    @Test
    void 삭제하면_그_러닝의_운동_부하를_지운다() throws Exception {
        long id = insertSession(userId, "COMPLETED", 7, watchId, phoneId, "READY", null);
        jdbc.update("UPDATE running_sessions SET ended_at = started_at + interval '10 minutes' WHERE id=?", id);
        jdbc.update(
                """
                INSERT INTO exercise_training_loads(user_id, source, running_session_id, started_at, ended_at,
                    metric_date, zone1_seconds, zone2_seconds, zone3_seconds, zone4_seconds, zone5_seconds,
                    training_load)
                SELECT user_id, 'RUNWAY_SESSION', id, started_at, ended_at, DATE '2026-11-01', 0, 0, 600, 0, 0, 30
                FROM running_sessions WHERE id=?
                """,
                id);
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id, metric_date, daily_training_load) VALUES (?, DATE '2026-11-01', 30)",
                userId);

        mockMvc.perform(deleteRequest(userId, id)).andExpect(status().isOk());
        assertThat(trainingLoadDispatcher.awaitIdle(java.time.Duration.ofSeconds(15))).isTrue();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM exercise_training_loads", Integer.class)).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT daily_training_load FROM daily_health_metrics WHERE user_id=?",
                                java.math.BigDecimal.class,
                                userId))
                .isNull();
    }

    @Test
    void 삭제할_수_없는_상태는_409_INVALID_STATE() throws Exception {
        // 회원별 활성 세션은 하나뿐이므로(uq_running_sessions_active) 활성 상태는 하나씩 만들어 확인한다.
        for (String active : new String[] {"READY", "RUNNING", "PAUSED"}) {
            long id = insertSession(userId, active, 2, watchId, phoneId, "PENDING", null);
            mockMvc.perform(deleteRequest(userId, id))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("INVALID_STATE"));
            assertThat(deleted(id)).isFalse();
            jdbc.update("UPDATE running_sessions SET status='CANCELLED' WHERE id=?", id);
        }
        long analysing = insertSession(userId, "COMPLETED", 4, watchId, phoneId, "PROCESSING", null);
        long analysisPending = insertSession(userId, "COMPLETED", 4, watchId, phoneId, "PENDING", null);
        long withCommand = insertSession(userId, "COMPLETED", 4, watchId, phoneId, "READY", null);
        insertCommand(withCommand, watchId, "SET_BPM", 4, "UNKNOWN");
        long interruptedPending = insertSession(userId, "INTERRUPTED", 2, watchId, phoneId, "FAILED", null);
        insertCommand(interruptedPending, watchId, "START", 1, "PENDING");

        for (long id :
                new long[] {analysing, analysisPending, withCommand, interruptedPending}) {
            mockMvc.perform(deleteRequest(userId, id))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("INVALID_STATE"));
            assertThat(deleted(id)).isFalse();
        }
    }

    @Test
    void 그룹_연결_세션은_그룹_종료와_분석완료가_필요하다() throws Exception {
        long mine = insertSession(userId, "COMPLETED", 4, watchId, phoneId, "READY", null);
        long other = insertSession(otherUserId, "COMPLETED", 4, otherWatchId, otherPhoneId, "PROCESSING", null);
        long groupRun = insertGroupRun("COMPLETED", true);
        joinGroup(groupRun, userId, mine);
        joinGroup(groupRun, otherUserId, other);

        mockMvc.perform(deleteRequest(userId, mine))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));

        jdbc.update("UPDATE running_sessions SET analysis_status='FAILED' WHERE id=?", other);
        mockMvc.perform(deleteRequest(userId, mine)).andExpect(status().isOk());

        long running = insertSession(userId, "COMPLETED", 4, watchId, phoneId, "READY", null);
        joinGroup(insertGroupRun("RUNNING", false), userId, running);
        mockMvc.perform(deleteRequest(userId, running))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
    }

    @Test
    void 본인_연결_게시물을_같은_시각으로_삭제하고_이미_삭제된_시각은_유지한다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 5, watchId, phoneId, "READY", null);
        long post1 = insertPost(userId, sessionId, false);
        long post2 = insertPost(userId, sessionId, false);
        long alreadyDeleted = insertPost(userId, sessionId, true);
        long otherSession = insertSession(userId, "COMPLETED", 5, watchId, phoneId, "READY", null);
        long unrelated = insertPost(userId, otherSession, false);

        String body =
                mockMvc.perform(deleteRequest(userId, sessionId))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        Instant deletedAt = Instant.parse(JSON.readTree(body).get("deletedAt").stringValue());

        assertThat(postDeletedAt(post1)).isEqualTo(deletedAt);
        assertThat(postDeletedAt(post2)).isEqualTo(deletedAt);
        assertThat(postDeletedAt(alreadyDeleted)).isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));
        assertThat(postDeletedAt(unrelated)).isNull();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT deleted_at FROM running_sessions WHERE id=?",
                                Timestamp.class,
                                sessionId)
                                .toInstant())
                .isEqualTo(deletedAt);

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        mockMvc.perform(deleteRequest(userId, sessionId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
    }

    @Test
    void 타인_게시물이_같은_세션을_참조하면_전체를_롤백한다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 5, watchId, phoneId, "READY", null);
        long mine = insertPost(userId, sessionId, false);
        insertPost(otherUserId, sessionId, false);

        mockMvc.perform(deleteRequest(userId, sessionId))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
        assertThat(deleted(sessionId)).isFalse();
        assertThat(postDeletedAt(mine)).isNull();
    }

    @Test
    void 타인_세션은_NOT_OWNER이고_형식오류는_400() throws Exception {
        long others = insertSession(otherUserId, "COMPLETED", 5, otherWatchId, otherPhoneId, "READY", null);
        mockMvc.perform(deleteRequest(userId, others))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        assertThat(deleted(others)).isFalse();
        mockMvc.perform(deleteRequest(userId, 999999))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        mockMvc.perform(deleteRequest(userId, "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }
}
