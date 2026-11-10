package com.runway.backend.domain.session;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S11 러닝 경로 조회(S15P31E105-549) — AC-7~AC-9. 합성 좌표만 넣는다. */
@Testcontainers
class RunningSessionRouteIntegrationTest extends RunningSessionIntegrationSupport {

    @AfterEach
    void removeRoutePoints() {
        // 상위 정리(running_sessions 삭제)가 경로점 FK에 막히지 않게 먼저 지운다.
        jdbc.update("DELETE FROM running_route_points");
    }

    private MockHttpServletRequestBuilder routeRequest(long user, Object sessionId) {
        return get("/api/v1/running-sessions/" + sessionId + "/route")
                .header("Authorization", SecurityTestSupport.bearer(user));
    }

    /** 세션 시작 기준 sec초 뒤의 위치. */
    private void point(long sessionId, Long deviceId, long sec, double lng, Double accuracy) {
        jdbc.update(
                """
                INSERT INTO running_route_points(running_session_id,measured_at,position,accuracy,device_id)
                SELECT ?, s.started_at + make_interval(secs => ?),
                       ST_SetSRID(ST_MakePoint(?, 37.5), 4326)::geography, ?, ?
                  FROM running_sessions s WHERE s.id = ?
                """,
                sessionId,
                (double) sec,
                lng,
                accuracy,
                deviceId,
                sessionId);
    }

    private long runningSession() {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '10 minutes' WHERE id=?",
                sessionId);
        return sessionId;
    }

    @Test
    void 워치를_우선하고_결측만_폰으로_채운_조각을_준다() throws Exception {
        long sessionId = runningSession();
        point(sessionId, watchId, 0, 127.000, 5.0);
        point(sessionId, phoneId, 5, 127.900, 5.0);
        point(sessionId, watchId, 10, 127.001, null);
        point(sessionId, watchId, 15, 127.050, 40.0);
        point(sessionId, phoneId, 40, 127.002, 4.0);
        point(sessionId, phoneId, 45, 127.003, 4.0);
        // 시작 전 위치는 경로에 넣지 않는다.
        point(sessionId, phoneId, -30, 126.000, 4.0);

        mockMvc.perform(routeRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(sessionId))
                .andExpect(jsonPath("$.segments", hasSize(2)))
                .andExpect(jsonPath("$.segments[0].source").value("WATCH"))
                .andExpect(jsonPath("$.segments[0].coordinates", hasSize(2)))
                .andExpect(jsonPath("$.segments[0].coordinates[0][0]").value(127.000))
                .andExpect(jsonPath("$.segments[0].coordinates[0][1]").value(37.5))
                .andExpect(jsonPath("$.segments[0].coordinates[1][0]").value(127.001))
                .andExpect(jsonPath("$.segments[1].source").value("PHONE"))
                .andExpect(jsonPath("$.segments[1].coordinates", hasSize(2)))
                .andExpect(jsonPath("$.segments[1].coordinates[0][0]").value(127.002))
                .andExpect(jsonPath("$.segments[0].measuredAt").doesNotExist())
                .andExpect(jsonPath("$.segments[0].accuracy").doesNotExist());
    }

    @Test
    void 종료_뒤의_위치는_빼고_시작_전_세션은_빈_경로다() throws Exception {
        long ended = runningSession();
        jdbc.update(
                "UPDATE running_sessions SET status='COMPLETED',"
                        + " ended_at = started_at + interval '20 seconds' WHERE id=?",
                ended);
        point(ended, watchId, 0, 127.000, 5.0);
        point(ended, watchId, 10, 127.001, 5.0);
        point(ended, watchId, 30, 127.002, 5.0);
        mockMvc.perform(routeRequest(userId, ended))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.segments", hasSize(1)))
                .andExpect(jsonPath("$.segments[0].coordinates", hasSize(2)));

        long ready = insertReadySession();
        mockMvc.perform(routeRequest(userId, ready))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.segments", hasSize(0)));
    }

    @Test
    void 타인_삭제_없는_세션과_탈퇴_회원은_거절한다() throws Exception {
        long others =
                insertSession(otherUserId, "RUNNING", 2, otherWatchId, otherPhoneId, "PENDING", null);
        long deleted = runningSession();
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);

        mockMvc.perform(routeRequest(userId, others))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SESSION_FORBIDDEN"));
        mockMvc.perform(routeRequest(userId, deleted))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        mockMvc.perform(routeRequest(userId, 999999))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        for (String bad : new String[] {"0", "-1", "abc"}) {
            mockMvc.perform(routeRequest(userId, bad))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mockMvc.perform(get("/api/v1/running-sessions/" + others + "/route"))
                .andExpect(status().isUnauthorized());

        long mine = runningSession();
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);
        mockMvc.perform(routeRequest(userId, mine)).andExpect(status().isUnauthorized());
    }
}
