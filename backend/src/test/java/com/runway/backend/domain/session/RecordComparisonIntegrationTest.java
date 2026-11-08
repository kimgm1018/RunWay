package com.runway.backend.domain.session;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.domain.session.stream.SessionStreamEventType;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S02 {@code comparison}(S15P31E105-422, sessions.md "기록 비교") 통합 테스트. 저장된 샘플·일시정지에서 계산한 값과 경계 상태를 확인한다. 모든 값은
 * 합성 데이터다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
@Import(RecordComparisonIntegrationTest.StreamRecorder.Config.class)
class RecordComparisonIntegrationTest extends RunningSessionIntegrationSupport {

    /** S10 등록소와 같은 조건(AFTER_COMMIT, fallbackExecution)으로 S10 전달 요청을 기록한다. */
    static class StreamRecorder {
        final List<SessionStreamChanged> events = new CopyOnWriteArrayList<>();

        @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
        void on(SessionStreamChanged event) {
            events.add(event);
        }

        @TestConfiguration
        static class Config {
            @Bean
            StreamRecorder streamRecorder() {
                return new StreamRecorder();
            }
        }
    }

    @Autowired private StreamRecorder recorder;
    @Autowired private SessionStreamRegistry streams;
    @Autowired private ApplicationEventPublisher publisher;
    @Autowired private PlatformTransactionManager transactionManager;

    private static final Instant PAST_START = Instant.parse("2026-10-20T01:00:00Z");
    private static final Instant NOW_START = Instant.parse("2026-10-28T01:00:00Z");

    private long courseId;

    @BeforeEach
    void course() {
        courseId = insertCourse("ACTIVE", "2000");
    }

    private long pastRun() {
        long id = insertSession(userId, "COMPLETED", 5, watchId, phoneId, "READY", courseId);
        times(id, PAST_START, PAST_START.plusSeconds(700));
        return id;
    }

    private long currentRun(String status, long comparisonId) {
        long id = insertSession(userId, status, 3, watchId, phoneId, "PENDING", courseId);
        jdbc.update(
                "UPDATE running_sessions SET comparison_session_id = ? WHERE id = ?", comparisonId, id);
        if (!"READY".equals(status)) {
            times(id, NOW_START, null);
        }
        return id;
    }

    private void times(long sessionId, Instant start, Instant end) {
        jdbc.update(
                "UPDATE running_sessions SET started_at = CAST(? AS timestamptz),"
                        + " ended_at = CAST(? AS timestamptz) WHERE id = ?",
                start.toString(),
                end == null ? null : end.toString(),
                sessionId);
    }

    private void sample(long sessionId, Instant start, long sec, String distance) {
        jdbc.update(
                "INSERT INTO running_metric_samples(running_session_id, device_id, measured_at,"
                        + " elapsed_duration, total_distance, route_progress, is_hr_measured)"
                        + " VALUES (?, ?, CAST(? AS timestamptz), ?, CAST(? AS numeric), 0, false)",
                sessionId,
                watchId,
                start.plusSeconds(sec).toString(),
                (int) sec,
                distance);
    }

    private void applied(long sessionId, String action, long version, Instant at) {
        jdbc.update(
                "INSERT INTO session_control_events(session_id, device_id, action, expected_version,"
                        + " result, applied_at)"
                        + " VALUES (?, ?, ?::session_control_events_action_enum, ?,"
                        + " 'APPLIED'::session_control_events_result_enum, CAST(? AS timestamptz))",
                sessionId,
                watchId,
                action,
                version,
                at.toString());
    }

    /** 0~1km 300초, 1~2km 400초. */
    private long unevenPastRun() {
        long past = pastRun();
        sample(past, PAST_START, 0, "0");
        sample(past, PAST_START, 300, "1000");
        sample(past, PAST_START, 700, "2000");
        return past;
    }

    @Test
    void 진행_중_러닝은_같은_거리_도달_운동시간_비교를_S02에_담는다() throws Exception {
        long past = unevenPastRun();
        long current = currentRun("RUNNING", past);
        sample(current, NOW_START, 0, "0");
        sample(current, NOW_START, 280, "1000");

        mockMvc.perform(getRequest(userId, current))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.comparison.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.comparison.targetStartedAt").value("2026-10-20T01:00:00Z"))
                .andExpect(jsonPath("$.comparison.distanceM").value(1000))
                .andExpect(jsonPath("$.comparison.currentElapsedSec").value(280))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(300));
    }

    @Test
    void 일시정지_구간은_양쪽_운동시간에서_뺀다() throws Exception {
        long past = pastRun();
        sample(past, PAST_START, 0, "0");
        sample(past, PAST_START, 360, "1000");
        applied(past, "PAUSE", 2, PAST_START.plusSeconds(100));
        applied(past, "RESUME", 3, PAST_START.plusSeconds(160));
        long current = currentRun("RUNNING", past);
        sample(current, NOW_START, 0, "0");
        sample(current, NOW_START, 310, "1000");
        applied(current, "PAUSE", 1, NOW_START.plusSeconds(150));
        applied(current, "RESUME", 2, NOW_START.plusSeconds(180));

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.comparison.currentElapsedSec").value(280))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(300));
    }

    @Test
    void 현재_거리가_과거_총거리를_넘으면_과거_총거리에서_비교한다() throws Exception {
        long current = currentRun("RUNNING", unevenPastRun());
        sample(current, NOW_START, 0, "0");
        sample(current, NOW_START, 600, "2000");
        sample(current, NOW_START, 650, "2200");

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.distanceM").value(2000))
                .andExpect(jsonPath("$.comparison.currentElapsedSec").value(600))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(700));
    }

    @Test
    void 시작_전이나_현재_거리_샘플이_없으면_WAITING이다() throws Exception {
        long past = unevenPastRun();
        long ready = currentRun("READY", past);

        mockMvc.perform(getRequest(userId, ready))
                .andExpect(jsonPath("$.comparison.status").value("WAITING"))
                .andExpect(jsonPath("$.comparison.targetStartedAt").value("2026-10-20T01:00:00Z"))
                .andExpect(jsonPath("$.comparison.distanceM").value(nullValue()));

        jdbc.update("UPDATE running_sessions SET status = 'CANCELLED' WHERE id = ?", ready);
        long running = currentRun("RUNNING", past);
        sample(running, NOW_START, 5, null);
        mockMvc.perform(getRequest(userId, running))
                .andExpect(jsonPath("$.comparison.status").value("WAITING"))
                .andExpect(jsonPath("$.comparison.currentElapsedSec").value(nullValue()));
    }

    @Test
    void 과거_기록에_거리_샘플이_없으면_NO_RECORD다() throws Exception {
        long past = pastRun();
        sample(past, PAST_START, 10, null);
        long current = currentRun("RUNNING", past);
        sample(current, NOW_START, 280, "1000");

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.status").value("NO_RECORD"))
                .andExpect(jsonPath("$.comparison.targetStartedAt").value("2026-10-20T01:00:00Z"))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(nullValue()));
    }

    @Test
    void 비교_기록이_삭제되면_UNAVAILABLE이고_러닝_상태는_그대로다() throws Exception {
        long past = unevenPastRun();
        long current = currentRun("RUNNING", past);
        sample(current, NOW_START, 280, "1000");
        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.status").value("AVAILABLE"));

        jdbc.update("UPDATE running_sessions SET deleted_at = now() WHERE id = ?", past);

        mockMvc.perform(getRequest(userId, current))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.goal.comparisonSessionId").value(past))
                .andExpect(jsonPath("$.comparison.status").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.comparison.targetStartedAt").value(nullValue()));
    }

    @Test
    void 비교_기록을_고르지_않은_세션은_comparison이_null이다() throws Exception {
        long current = insertSession(userId, "RUNNING", 3, watchId, phoneId, "PENDING", courseId);

        mockMvc.perform(getRequest(userId, current))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.comparison").value(nullValue()));
    }

    @Test
    void 비교_기록에_늦게_도착한_샘플은_다음_조회에_반영된다() throws Exception {
        long past = pastRun();
        sample(past, PAST_START, 0, "0");
        sample(past, PAST_START, 300, "1000");
        long current = currentRun("RUNNING", past);
        sample(current, NOW_START, 280, "1500");
        // 과거 총거리 1000m에서 비교
        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.distanceM").value(1000));

        sample(past, PAST_START, 700, "2000");

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.distanceM").value(1500))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(500));
    }
    @Test
    void 비교_기록이_다른_회원의_것이거나_완료되지_않았으면_UNAVAILABLE이다() throws Exception {
        long others = insertSession(otherUserId, "COMPLETED", 5, otherWatchId, otherPhoneId, "READY", courseId);
        times(others, PAST_START, PAST_START.plusSeconds(700));
        sample(others, PAST_START, 300, "1000");
        long current = currentRun("RUNNING", others);
        sample(current, NOW_START, 280, "1000");

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.status").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.comparison.targetStartedAt").value(nullValue()));

        long cancelled = insertSession(userId, "CANCELLED", 5, watchId, phoneId, "PENDING", courseId);
        times(cancelled, PAST_START, PAST_START.plusSeconds(700));
        sample(cancelled, PAST_START, 300, "1000");
        jdbc.update(
                "UPDATE running_sessions SET comparison_session_id = ? WHERE id = ?", cancelled, current);

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.status").value("UNAVAILABLE"));
    }

    @Test
    void 비교_세션의_batch가_커밋되면_버전_변경_없이_SESSION_STATE를_요청한다() throws Exception {
        long current = currentRun("RUNNING", unevenPastRun());
        long plain = insertSession(otherUserId, "RUNNING", 3, otherWatchId, otherPhoneId, "PENDING", courseId);
        streams.subscribe(userId, current, Instant.now().plus(Duration.ofHours(1)));
        streams.subscribe(otherUserId, plain, Instant.now().plus(Duration.ofHours(1)));
        recorder.events.clear();
        long version = stateVersion(current);

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.executeWithoutResult(status -> publisher.publishEvent(new RunningBatchCommittedEvent(current)));
        tx.executeWithoutResult(status -> publisher.publishEvent(new RunningBatchCommittedEvent(plain)));

        assertThat(recorder.events)
                .containsExactly(new SessionStreamChanged(current, SessionStreamEventType.SESSION_STATE, null));
        assertThat(stateVersion(current)).isEqualTo(version);
    }

    @Test
    void 종료된_비교_기록의_일시정지_결과가_바뀌면_다시_계산한다() throws Exception {
        long past = pastRun();
        sample(past, PAST_START, 0, "0");
        sample(past, PAST_START, 360, "1000");
        long current = currentRun("RUNNING", past);
        sample(current, NOW_START, 280, "1000");
        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(360));

        applied(past, "PAUSE", 2, PAST_START.plusSeconds(100));
        applied(past, "RESUME", 3, PAST_START.plusSeconds(160));

        mockMvc.perform(getRequest(userId, current))
                .andExpect(jsonPath("$.comparison.pastElapsedSec").value(300));
    }
}
