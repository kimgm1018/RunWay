package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.MediaType;
import org.testcontainers.junit.jupiter.Testcontainers;

/** AC-5·AC-6·AC-7·AC-8·AC-15. 인증·소유·동의·기기 상태·세션 상태 검사. 거절 시 행이 남지 않는다. */
@Testcontainers
class SyncBatchAuthorizationIntegrationTest extends SyncBatchIntegrationSupport {

    private void expect(long user, String body, int status, String code) throws Exception {
        int before = storedRows();
        mockMvc.perform(syncRequest(user, body))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code));
        assertThat(storedRows()).isEqualTo(before);
    }

    // AC-5 인증·소유

    @Test
    void 토큰이_없으면_401() throws Exception {
        long sessionId = runningSession();
        mockMvc.perform(
                        post("/api/v1/sync/batches")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(batch(newBatchId(), watchId, sessionId, metric(1, 142))))
                .andExpect(status().isUnauthorized());
        assertThat(storedRows()).isZero();
    }

    @Test
    void 탈퇴한_회원은_401() throws Exception {
        long sessionId = runningSession();
        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE id=?", userId);
        expect(userId, batch(newBatchId(), watchId, sessionId, metric(1, 142)), 401, "UNAUTHORIZED");
    }

    @Test
    void 타인_기기나_없는_기기는_403_DEVICE_FORBIDDEN() throws Exception {
        long sessionId = runningSession();
        expect(userId, batch(newBatchId(), otherWatchId, sessionId, metric(1, 142)), 403, "DEVICE_FORBIDDEN");
        expect(userId, batch(newBatchId(), 999_999_999L, sessionId, metric(1, 142)), 403, "DEVICE_FORBIDDEN");
    }

    @Test
    void 없는_삭제된_타인_세션은_403_SESSION_FORBIDDEN() throws Exception {
        long otherSession = insertSession(otherUserId, "RUNNING", 2, otherWatchId, null);
        expect(userId, batch(newBatchId(), watchId, otherSession, metric(1, 142)), 403, "SESSION_FORBIDDEN");
        expect(userId, batch(newBatchId(), watchId, 999_999_999L, metric(1, 142)), 403, "SESSION_FORBIDDEN");

        long deleted = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET status='COMPLETED', deleted_at=now() WHERE id=?", deleted);
        expect(userId, batch(newBatchId(), watchId, deleted, metric(1, 142)), 403, "SESSION_FORBIDDEN");
    }

    @Test
    void 세션과_무관한_본인_기기는_403_SESSION_FORBIDDEN() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId);
        jdbc.update("UPDATE user_devices SET unlinked_at=now() WHERE id=?", watchId);
        long newWatch = insertDevice(userId, "WATCH", false);
        expect(userId, batch(newBatchId(), newWatch, sessionId, metric(1, 142)), 403, "SESSION_FORBIDDEN");
    }

    // AC-6·AC-15 건강 동의(D-2)

    @Test
    void 건강정보_미동의면_측정_샘플이_있는_batch는_403이고_GPS만은_저장한다() throws Exception {
        long sessionId = runningSession();
        // 동의 철회가 먼저 확정된 상황을 DB 변경으로 재현한다(W04 경합은 ConsentConcurrencyIntegrationTest).
        jdbc.update(
                "UPDATE users SET health_data_access='DISAGREE'::users_health_data_access_enum WHERE id=?",
                userId);

        expect(userId, batch(newBatchId(), watchId, sessionId, metric(1, 142)), 403, "CONSENT_REQUIRED");
        expect(userId, batch(newBatchId(), watchId, sessionId, gps(1), metric(1, null)), 403, "CONSENT_REQUIRED");
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), phoneId, sessionId, gps(1), gps(2))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(2));
        assertThat(count("SELECT count(*) FROM running_route_points WHERE running_session_id=?", sessionId))
                .isEqualTo(2);
    }

    /** 동의 검사가 재응답보다 먼저다(2026-11-02 사용자 결정). 저장 후 응답 유실 → 철회 → 재전송이면 403이고 저장된 원본은 그대로다. */
    @Test
    void 동의_철회_뒤에는_이미_저장된_측정_batch_재전송도_403() throws Exception {
        long sessionId = runningSession();
        String saved = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        mockMvc.perform(syncRequest(userId, saved)).andExpect(status().isOk());
        jdbc.update(
                "UPDATE users SET health_data_access='DISAGREE'::users_health_data_access_enum WHERE id=?",
                userId);

        expect(userId, saved, 403, "CONSENT_REQUIRED");
        assertThat(count("SELECT count(*) FROM running_metric_samples WHERE running_session_id=?", sessionId))
                .isEqualTo(1);
    }

    // AC-7 기기 상태(D-3, D-5)

    @Test
    void 해제된_기기의_새_batch는_403이고_해제_전_저장한_batch는_ACK를_재응답한다() throws Exception {
        long sessionId = runningSession();
        String saved = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        mockMvc.perform(syncRequest(userId, saved)).andExpect(status().isOk());
        jdbc.update("UPDATE user_devices SET unlinked_at=now() WHERE id=?", watchId);
        int before = storedRows();

        mockMvc.perform(syncRequest(userId, saved))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMMITTED"));
        expect(userId, batch(newBatchId(), watchId, sessionId, metric(2, 142)), 403, "DEVICE_FORBIDDEN");
        assertThat(storedRows()).isEqualTo(before);
    }

    @Test
    void 폰_인계_뒤_이전_워치의_새_batch는_409_CONTROL_DEVICE_CHANGED() throws Exception {
        long sessionId = runningSession();
        insertCommand(sessionId, watchId, "START", 1, "APPLIED");
        String saved = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        mockMvc.perform(syncRequest(userId, saved)).andExpect(status().isOk());
        // S08 TAKE_OVER_PHONE 결과: 제어 기기를 중계 폰으로 바꾼다.
        jdbc.update(
                "UPDATE running_sessions SET control_device_id=relay_device_id, state_version=3 WHERE id=?",
                sessionId);

        expect(userId, batch(newBatchId(), watchId, sessionId, metric(2, 142)), 409, "CONTROL_DEVICE_CHANGED");
        mockMvc.perform(syncRequest(userId, saved)).andExpect(status().isOk());
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), phoneId, sessionId, gps(3))))
                .andExpect(status().isOk());
    }

    @Test
    void 폰_인계_세션이라도_제어_이력이_없는_워치는_403_SESSION_FORBIDDEN() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 3, phoneId, phoneId);
        expect(userId, batch(newBatchId(), watchId, sessionId, metric(1, 142)), 403, "SESSION_FORBIDDEN");
    }

    @Test
    void 워치_기록_중에도_중계_폰의_GPS_batch를_받는다() throws Exception {
        long sessionId = runningSession();
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), phoneId, sessionId, gps(1))))
                .andExpect(status().isOk());
    }

    // AC-8 세션 상태(D-1)

    static Stream<Arguments> sessionStates() {
        return Stream.of(
                Arguments.of("READY", 1L, "PENDING", 200, null),
                Arguments.of("READY", 1L, "UNKNOWN", 200, null),
                Arguments.of("READY", 1L, "APPLIED_SET_BPM", 409, "INVALID_SESSION_STATE"),
                Arguments.of("READY", 1L, null, 409, "INVALID_SESSION_STATE"),
                Arguments.of("RUNNING", 2L, null, 200, null),
                Arguments.of("PAUSED", 3L, null, 200, null),
                Arguments.of("COMPLETED", 4L, null, 409, "INVALID_SESSION_STATE"),
                Arguments.of("CANCELLED", 1L, null, 409, "INVALID_SESSION_STATE"),
                Arguments.of("INTERRUPTED", 2L, "UNKNOWN", 409, "INVALID_SESSION_STATE"),
                Arguments.of("READY", 0L, "PENDING", 409, "INVALID_SESSION_STATE"));
    }

    @ParameterizedTest(name = "{0} v{1} START={2} → {3}")
    @MethodSource("sessionStates")
    void 새_batch는_세션_상태에_따라_받거나_거절한다(
            String state, long version, String start, int expected, String code) throws Exception {
        long sessionId = insertSession(userId, state, version, watchId, phoneId);
        if ("APPLIED_SET_BPM".equals(start)) {
            insertCommand(sessionId, watchId, "SET_BPM", 1, "APPLIED");
        } else if (start != null && version >= 1) {
            insertCommand(sessionId, watchId, "START", 1, start);
        }
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        if (expected == 200) {
            mockMvc.perform(syncRequest(userId, body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("COMMITTED"));
            assertThat(count("SELECT count(*) FROM running_metric_samples WHERE running_session_id=?", sessionId))
                    .isEqualTo(1);
        } else {
            expect(userId, body, expected, code);
        }
    }
}
