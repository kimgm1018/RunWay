package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.service.SessionCoachingService;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 서버 코칭 발행과 S02 coaching 노출 — 257 작업 계획 AC-9·AC-10. 421부터 추천은 AI04 대역({@code FakePaceDecider}: 기준 페이스 유지·BPM
 * 160)이 만든다. 모든 값은 합성 데이터다.
 */
@Testcontainers
class SessionCoachingIntegrationTest extends RunningSessionIntegrationSupport {

    @Autowired private SessionCoachingService service;
    @Autowired private ApplicationEventPublisher events;
    @Autowired private TransactionTemplate tx;
    @Autowired private SessionStreamRegistry streams;

    /** 시작 후 3분이 지난 워치 기록 RUNNING 세션. */
    private long dueSession() {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 180);
        return sessionId;
    }

    private int coachingCount(long sessionId) {
        return count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId);
    }

    @Test
    void 시작_2분_뒤_코칭과_COACHING_명령을_한_건_만든다() {
        long sessionId = dueSession();

        SessionControlEvent command = service.issueIfDue(sessionId).orElseThrow();

        Map<String, Object> decision =
                jdbc.queryForMap(
                        """
                        SELECT recommended_pace, cue_bpm, based_on_state_version, elapsed_duration,
                               extract(epoch FROM expires_at - created_at) AS valid_sec
                        FROM coaching_decisions WHERE session_id=?
                        """,
                        sessionId);
        // 계획·목표·적용 코칭이 없으면 최근 60초 실측 평균(2.5m/s = 400초/km)이 기준 페이스다.
        assertThat(decision.get("recommended_pace").toString()).isEqualTo("400.00");
        assertThat(((Number) decision.get("cue_bpm")).intValue()).isEqualTo(160);
        assertThat(((Number) decision.get("based_on_state_version")).longValue()).isEqualTo(2);
        assertThat(((Number) decision.get("elapsed_duration")).intValue()).isBetween(179, 200);
        // 만료 = min(생성 + 20초, 입력 기준시각 + 20초). 마지막 표본이 막 측정됐으므로 20초에 가깝다.
        assertThat(((Number) decision.get("valid_sec")).doubleValue()).isBetween(15.0, 20.0);
        assertThat(command.getAction().name()).isEqualTo("COACHING");
        assertThat(command.getDeviceId()).isEqualTo(watchId);
        assertThat(command.getExpectedVersion()).isEqualTo(2);
        assertThat(command.getTargetBpm()).isEqualTo(160);
        assertThat(command.getResult().name()).isEqualTo("PENDING");
        // 코칭 생성 자체는 버전을 바꾸지 않는다.
        assertThat(stateVersion(sessionId)).isEqualTo(2);
        // 미확정 코칭이 있으므로 다시 판단해도 더 만들지 않는다.
        assertThat(service.issueIfDue(sessionId)).isEmpty();
        assertThat(coachingCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 계획_페이스가_있으면_계획_페이스를_기준_페이스로_보낸다() {
        long sessionId = dueSession();
        jdbc.update(
                "INSERT INTO pace_plans(session_id,recommended_pace,created_at) VALUES (?,330.50,now())",
                sessionId);

        SessionControlEvent command = service.issueIfDue(sessionId).orElseThrow();

        assertThat(command.getTargetBpm()).isEqualTo(160);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT recommended_pace::text FROM coaching_decisions WHERE session_id=?",
                                String.class,
                                sessionId))
                .isEqualTo("330.50");
    }

    /** 사용자당 활성 세션은 하나이므로(V8) 사례마다 새 회원·워치·폰을 만든다. 반환값은 {세션, 워치}. */
    private long[] sessionOfNewUser(String state, boolean phoneFallback, long startedSecondsAgo) {
        long owner = insertUser("AGREE");
        long watch = insertDevice(owner, "WATCH", false);
        long phone = insertDevice(owner, "PHONE", false);
        long sessionId =
                insertSession(owner, state, 2, phoneFallback ? phone : watch, phone, "PENDING", null);
        startedSecondsAgo(sessionId, startedSecondsAgo);
        return new long[] {sessionId, watch};
    }

    @Test
    void 발행_조건을_만족하지_않으면_만들지_않는다() {
        long notYet = sessionOfNewUser("RUNNING", false, 100)[0];
        long paused = sessionOfNewUser("PAUSED", false, 300)[0];
        long fallback = sessionOfNewUser("RUNNING", true, 300)[0];
        long[] pending = sessionOfNewUser("RUNNING", false, 300);
        insertCommand(pending[0], pending[1], "SET_BPM", 2, "PENDING");
        long[] unknown = sessionOfNewUser("RUNNING", false, 300);
        insertCommand(unknown[0], unknown[1], "PAUSE", 1, "UNKNOWN");
        long[] recentResume = sessionOfNewUser("RUNNING", false, 300);
        insertCommand(recentResume[0], recentResume[1], "RESUME", 1, "APPLIED");
        long[] recentCoaching = sessionOfNewUser("RUNNING", false, 300);
        insertCoaching(recentCoaching[0], recentCoaching[1], 1, 165, "APPLIED", false);

        for (long sessionId :
                new long[] {
                    notYet, paused, fallback, pending[0], unknown[0], recentResume[0], recentCoaching[0]
                }) {
            assertThat(service.issueIfDue(sessionId)).as("session %d", sessionId).isEmpty();
        }
        assertThat(
                        count(
                                "SELECT count(*) FROM session_control_events"
                                        + " WHERE action='COACHING' AND result='PENDING'"))
                .isZero();
    }

    @Test
    void 마지막_적용_후_2분이_지나면_다시_발행한다() {
        long sessionId = dueSession();
        insertCommand(sessionId, watchId, "RESUME", 1, "APPLIED");
        jdbc.update(
                "UPDATE session_control_events SET applied_at = now() - interval '130 seconds' WHERE session_id=?",
                sessionId);

        assertThat(service.issueIfDue(sessionId)).isPresent();
    }

    @Test
    void 적용되지_않은_코칭_뒤에는_발행_30초가_지나야_다시_보낸다() {
        long sessionId = dueSession();
        long[] ignored = insertCoaching(sessionId, watchId, 1, 165, "IGNORED", false);
        jdbc.update(
                "UPDATE session_control_events SET created_at = now() - interval '10 seconds' WHERE id=?",
                ignored[1]);

        assertThat(service.issueIfDue(sessionId)).isEmpty();

        jdbc.update(
                "UPDATE session_control_events SET created_at = now() - interval '31 seconds' WHERE id=?",
                ignored[1]);
        assertThat(service.issueIfDue(sessionId)).isPresent();
    }

    @Test
    void 거절된_코칭도_30초_간격을_지킨다() {
        long sessionId = dueSession();
        long[] rejected = insertCoaching(sessionId, watchId, 1, 165, "REJECTED", false);
        jdbc.update(
                "UPDATE session_control_events SET created_at = now() - interval '5 seconds' WHERE id=?",
                rejected[1]);

        assertThat(service.issueIfDue(sessionId)).isEmpty();
    }

    @Test
    void 건강정보_미동의_세션에는_발행하지_않는다() {
        long sessionId = dueSession();
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);

        assertThat(service.issueIfDue(sessionId)).isEmpty();
        assertThat(coachingCount(sessionId)).isZero();
    }

    @Test
    void 종료된_그룹의_세션과_삭제된_세션에는_발행하지_않는다() {
        long grouped = dueSession();
        joinGroup(insertGroupRun("COMPLETED", true), userId, grouped);
        long deleted = sessionOfNewUser("RUNNING", false, 300)[0];
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);

        assertThat(service.issueIfDue(grouped)).isEmpty();
        assertThat(service.issueIfDue(deleted)).isEmpty();
    }

    @Test
    void batch_저장_커밋_이벤트로_발행을_판단한다() throws Exception {
        long sessionId = dueSession();
        streams.subscribe(userId, sessionId, null);

        tx.executeWithoutResult(status -> events.publishEvent(new RunningBatchCommittedEvent(sessionId)));

        Instant deadline = Instant.now().plus(Duration.ofSeconds(10));
        while (coachingCount(sessionId) == 0 && Instant.now().isBefore(deadline)) {
            Thread.sleep(50);
        }
        assertThat(coachingCount(sessionId)).isEqualTo(1);
    }

    // ---- AC-10 S02 coaching 노출 ----

    @Test
    void 유효한_코칭은_S02_coaching과_pendingCommand_guide로_보인다() throws Exception {
        long sessionId = dueSession();
        SessionControlEvent command = service.issueIfDue(sessionId).orElseThrow();

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coaching.commandId").value(command.getId()))
                .andExpect(jsonPath("$.coaching.coachingId").value(command.getCoachingId()))
                .andExpect(jsonPath("$.coaching.expectedVersion").value(2))
                .andExpect(jsonPath("$.coaching.targetBpm").value(160))
                .andExpect(jsonPath("$.coaching.recommendedPaceSecPerKm").value(400.0))
                .andExpect(jsonPath("$.coaching.expiresAt").exists())
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.commandId").value(command.getId()));
    }

    @Test
    void 만료된_미확정_코칭은_coaching_null이고_guide만_남는다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        long[] coaching = insertCoaching(sessionId, watchId, 2, 165, "PENDING", true);

        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(jsonPath("$.coaching").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.coachingGuide.commandId").value(coaching[1]));
    }
}
