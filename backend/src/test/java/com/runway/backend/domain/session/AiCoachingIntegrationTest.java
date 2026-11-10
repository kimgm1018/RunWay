package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.coaching.decide.FakePaceDecider;
import com.runway.backend.domain.coaching.decide.PaceDecideRequest;
import com.runway.backend.domain.coaching.decide.PaceDecision;
import com.runway.backend.domain.session.service.SessionCoachingService;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * AI04 판단 → 저장·발행 — 421 플랜 AC-2·AC-3·AC-4·AC-5·AC-6·AC-8·AC-11(T-6·T-8·T-9·T-10). AI는 {@link FakePaceDecider}로
 * 대신한다. 모든 값은 합성 데이터다.
 */
@Testcontainers
class AiCoachingIntegrationTest extends RunningSessionIntegrationSupport {

    @Autowired private SessionCoachingService service;

    /** 시작 3분 지난 워치 기록 RUNNING 세션(버전 2)과 최근 표본. */
    private long dueSession() {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 180);
        return sessionId;
    }

    /** 시작 60초 지난 세션. 2분 재평가 전이다. */
    private long earlySession() {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 60);
        return sessionId;
    }

    private int coachingCount(long sessionId) {
        return count("SELECT count(*) FROM coaching_decisions WHERE session_id=?", sessionId);
    }

    private int coachingCommandCount(long sessionId) {
        return count(
                "SELECT count(*) FROM session_control_events WHERE session_id=? AND action='COACHING'",
                sessionId);
    }

    private void respondChange(boolean suggested, PaceDecision.Action action, String pace, Integer bpm) {
        paceDecider.respond(
                request ->
                        Optional.of(
                                FakePaceDecider.decision(
                                        request, suggested, action, new BigDecimal(pace), bpm)));
    }

    // ---- AC-2 요청 ----

    @Test
    void 동의_사용자의_요청에는_userId와_세션_상태를_담는다() {
        long sessionId = dueSession();

        service.issueIfDue(sessionId);

        assertThat(paceDecider.requests()).hasSize(1);
        PaceDecideRequest request = paceDecider.requests().get(0);
        assertThat(request.userId()).isEqualTo(userId);
        assertThat(request.elapsedSec()).isEqualTo(180);
        assertThat(request.context().sessionId()).isEqualTo(sessionId);
        assertThat(request.context().stateVersion()).isEqualTo(2);
        assertThat(request.context().mode()).isEqualTo("FREE_NO_GOAL");
        assertThat(request.history().hrBpm()).last().isEqualTo(150.0);
        assertThat(request.candidates()).hasSize(9);
    }

    @Test
    void 코스_세션은_저장된_100m_경사로_미래_경사를_채운다() {
        long courseId = insertCourse("ACTIVE", "3000");
        StringBuilder profile = new StringBuilder("[");
        for (int start = 0; start < 3000; start += 100) {
            if (start > 0) profile.append(',');
            profile.append("{\"startDistanceM\":").append(start)
                    .append(",\"endDistanceM\":").append(start + 100)
                    .append(",\"gradePercent\":1.5}");
        }
        jdbc.update("UPDATE courses SET elevation_profile=?::jsonb WHERE id=?", profile + "]", courseId);
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", courseId);
        startedSecondsAgo(sessionId, 180);

        service.issueIfDue(sessionId);

        PaceDecideRequest request = paceDecider.requests().get(0);
        assertThat(request.context().mode()).isEqualTo("COURSE");
        assertThat(request.context().routeProgressM()).isEqualTo(450.0);
        assertThat(request.candidates().get(3).futureGradePct()).hasSize(24).containsOnly(1.5);
    }

    // ---- AC-3 입력 부족·오래됨 ----

    @Test
    void 측정이_없거나_12초_이상_오래되면_AI를_부르지_않는다() {
        long noSamples = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = now() - interval '3 minutes' WHERE id=?",
                noSamples);
        assertThat(service.issueIfDue(noSamples)).isEmpty();

        long stale = sessionOfNewUser();
        jdbc.update(
                "UPDATE running_metric_samples SET measured_at = measured_at - interval '25 seconds'"
                        + " WHERE running_session_id=?",
                stale);
        assertThat(service.issueIfDue(stale)).isEmpty();

        long noHr = sessionOfNewUser();
        jdbc.update(
                "UPDATE running_metric_samples SET heart_rate=NULL, is_hr_measured=false"
                        + " WHERE running_session_id=?",
                noHr);
        assertThat(service.issueIfDue(noHr)).isEmpty();

        assertThat(paceDecider.requests()).isEmpty();
    }

    /** 사용자당 활성 세션은 하나이므로 새 회원으로 시작 3분 지난 세션을 만든다. */
    private long sessionOfNewUser() {
        long owner = insertUser("AGREE");
        long watch = insertDevice(owner, "WATCH", false);
        long phone = insertDevice(owner, "PHONE", false);
        long sessionId = insertSession(owner, "RUNNING", 2, watch, phone, "PENDING", null);
        startedSecondsAgo(sessionId, 180);
        return sessionId;
    }

    // ---- AC-4·AC-5·AC-11 발행 규칙 ----

    @Test
    void AI_판단을_예측_심박과_함께_저장하고_명령을_승인한다() {
        long sessionId = dueSession();
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "395.50", 168);

        var command = service.issueIfDue(sessionId).orElseThrow();

        Map<String, Object> row =
                jdbc.queryForMap(
                        """
                        SELECT recommended_pace::text AS pace, cue_bpm, predicted_hr_30_bpm::text AS hr30,
                               predicted_hr_60_bpm::text AS hr60, predicted_hr_120_bpm::text AS hr120,
                               based_on_state_version, elapsed_duration,
                               expires_at <= created_at + interval '20 seconds' AS within_20s
                        FROM coaching_decisions WHERE session_id=?
                        """,
                        sessionId);
        assertThat(row.get("pace")).isEqualTo("395.50");
        assertThat(((Number) row.get("cue_bpm")).intValue()).isEqualTo(168);
        assertThat(row.get("hr30")).isEqualTo("150.00");
        assertThat(row.get("hr60")).isEqualTo("152.00");
        assertThat(row.get("hr120")).isEqualTo("155.00");
        assertThat(((Number) row.get("based_on_state_version")).longValue()).isEqualTo(2);
        assertThat(((Number) row.get("elapsed_duration")).intValue()).isEqualTo(180);
        assertThat(row.get("within_20s")).isEqualTo(true);
        assertThat(command.getTargetBpm()).isEqualTo(168);
        assertThat(command.getExpectedVersion()).isEqualTo(2);
    }

    @Test
    void 판단이_없거나_NOT_RUNNING이면_저장하지_않는다() {
        long none = dueSession();
        paceDecider.respond(request -> Optional.empty());
        assertThat(service.issueIfDue(none)).isEmpty();

        long notRunning = sessionOfNewUser();
        respondChange(true, PaceDecision.Action.NOT_RUNNING, "500.00", 160);
        assertThat(service.issueIfDue(notRunning)).isEmpty();

        assertThat(count("SELECT count(*) FROM coaching_decisions")).isZero();
        // 두 세션 모두 AI는 불렀다(입력 부족으로 우연히 통과하지 않는다).
        assertThat(paceDecider.requests()).hasSize(2);
    }

    @Test
    void 두_분_전에는_AI가_제안한_변경만_보낸다() {
        long sessionId = earlySession();

        // 기준 페이스(400초/km)·BPM 160 유지, 발행 제안 없음
        assertThat(service.issueIfDue(sessionId)).isEmpty();
        // 같은 내용이면 제안이 있어도 보내지 않는다(현재 BPM 160).
        jdbc.update("UPDATE running_sessions SET current_bpm=160 WHERE id=?", sessionId);
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "400.00", 160);
        assertThat(service.issueIfDue(sessionId)).isEmpty();
        // 다른 페이스를 제안하면 보낸다.
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "390.00", 163);
        assertThat(service.issueIfDue(sessionId)).isPresent();
        assertThat(coachingCommandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 적용_후_30초_전에는_페이스가_같은_BPM_변경은_막고_AI_페이스_변경은_보낸다() {
        // S15P31E105-624: 페이스 변경의 쿨다운은 AI04가 맡는다(120초). 백엔드 30초 간격은 페이스가 그대로인 발행에만 건다.
        long sessionId = earlySession();
        long[] applied = insertCoaching(sessionId, watchId, 1, 165, "APPLIED", false);
        jdbc.update(
                "UPDATE session_control_events SET applied_at = now() - interval '10 seconds' WHERE id=?",
                applied[1]);

        respondChange(true, PaceDecision.Action.GUIDE_PACE, "360.00", 170);
        assertThat(service.issueIfDue(sessionId)).isEmpty();

        respondChange(true, PaceDecision.Action.GUIDE_PACE, "350.00", 165);
        assertThat(service.issueIfDue(sessionId)).isPresent();
        // 적용된 코칭(360.00)이 기준 페이스였다.
        assertThat(paceDecider.requests().get(0).context().anchorPaceSecPerKm())
                .isEqualByComparingTo("360.00");
        assertThat(paceDecider.requests().get(0).context().lastCoaching().coachingId())
                .isEqualTo(applied[0]);
    }

    @Test
    void cueBpm이_없으면_현재_BPM으로_보내고_현재_BPM도_없으면_보내지_않는다() {
        long withBpm = dueSession();
        jdbc.update("UPDATE running_sessions SET current_bpm=171 WHERE id=?", withBpm);
        respondChange(false, PaceDecision.Action.GUIDE_PACE, "400.00", null);
        assertThat(service.issueIfDue(withBpm)).get().satisfies(c -> assertThat(c.getTargetBpm()).isEqualTo(171));

        long withoutBpm = sessionOfNewUser();
        assertThat(service.issueIfDue(withoutBpm)).isEmpty();
        assertThat(coachingCount(withoutBpm)).isZero();
        assertThat(paceDecider.requests()).hasSize(2);
    }

    @Test
    void 두_분_유지_안내는_현재_안내를_보내고_예측_심박을_남기지_않는다() {
        long sessionId = dueSession();
        jdbc.update("UPDATE running_sessions SET current_bpm=166 WHERE id=?", sessionId);
        respondChange(false, PaceDecision.Action.GUIDE_PACE, "395.00", 170);

        var command = service.issueIfDue(sessionId).orElseThrow();

        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT recommended_pace::text AS pace, predicted_hr_30_bpm, predicted_hr_60_bpm,"
                                + " predicted_hr_120_bpm FROM coaching_decisions WHERE session_id=?",
                        sessionId);
        assertThat(row.get("pace")).isEqualTo("400.00");
        assertThat(row.get("predicted_hr_30_bpm")).isNull();
        assertThat(row.get("predicted_hr_60_bpm")).isNull();
        assertThat(row.get("predicted_hr_120_bpm")).isNull();
        assertThat(command.getTargetBpm()).isEqualTo(166);
    }

    @Test
    void 사용자가_BPM을_직접_바꾼_러닝은_AI_BPM으로_덮어쓰지_않는다() {
        long sessionId = dueSession();
        insertCommand(sessionId, watchId, "SET_BPM", 1, "APPLIED");
        jdbc.update(
                "UPDATE session_control_events SET applied_at = now() - interval '150 seconds' WHERE session_id=?",
                sessionId);
        jdbc.update("UPDATE running_sessions SET current_bpm=158 WHERE id=?", sessionId);
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "390.00", 172);

        var command = service.issueIfDue(sessionId).orElseThrow();

        assertThat(command.getTargetBpm()).isEqualTo(158);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT recommended_pace::text FROM coaching_decisions WHERE session_id=?",
                                String.class,
                                sessionId))
                .isEqualTo("390.00");
    }

    @Test
    void 감속_권고가_적용된_뒤_이어지는_감속_권고는_30초_간격을_지킨다() {
        long sessionId = earlySession();
        respondChange(true, PaceDecision.Action.EASE_OFF, "430.00", 158);
        var first = service.issueIfDue(sessionId).orElseThrow();
        // 워치가 첫 감속 권고를 방금 적용했다. 적용 결과는 상태 버전을 올리고 현재 BPM을 바꾼다.
        jdbc.update(
                "UPDATE session_control_events SET result='APPLIED', applied_at=now() WHERE id=?",
                first.getId());
        jdbc.update(
                "UPDATE running_sessions SET state_version=state_version+1, current_bpm=158 WHERE id=?",
                sessionId);

        // 직전도 감속 권고이므로 30초 안의 다음 감속 권고는 보내지 않는다(AI는 불렀다).
        respondChange(true, PaceDecision.Action.EASE_OFF, "460.00", 155);
        assertThat(service.issueIfDue(sessionId)).isEmpty();
        assertThat(paceDecider.requests()).hasSize(2);

        // 30초가 지나면 보낸다.
        jdbc.update(
                "UPDATE session_control_events SET applied_at = now() - interval '31 seconds' WHERE id=?",
                first.getId());
        assertThat(service.issueIfDue(sessionId)).isPresent();
        assertThat(coachingCount(sessionId)).isEqualTo(2);
    }

    @Test
    void 출발_전에_고른_BPM은_수동_BPM으로_세지_않는다() {
        long sessionId = dueSession();
        insertCommand(sessionId, watchId, "SET_BPM", 1, "APPLIED");
        // 시작(3분 전)보다 앞서 적용됐다.
        jdbc.update(
                "UPDATE session_control_events SET applied_at = now() - interval '200 seconds' WHERE session_id=?",
                sessionId);
        jdbc.update("UPDATE running_sessions SET current_bpm=158 WHERE id=?", sessionId);
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "390.00", 172);

        assertThat(service.issueIfDue(sessionId)).get()
                .satisfies(c -> assertThat(c.getTargetBpm()).isEqualTo(172));
    }

    @Test
    void 거절된_수동_BPM은_AI_BPM_적용을_막지_않는다() {
        long sessionId = dueSession();
        insertCommand(sessionId, watchId, "SET_BPM", 1, "REJECTED");
        jdbc.update("UPDATE running_sessions SET current_bpm=158 WHERE id=?", sessionId);
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "390.00", 172);

        assertThat(service.issueIfDue(sessionId)).get()
                .satisfies(c -> assertThat(c.getTargetBpm()).isEqualTo(172));
    }

    /** 명령을 워치가 적용한 것처럼 기록한다. 적용 결과는 상태 버전을 올리고 현재 BPM을 바꾼다. */
    private void applied(long sessionId, long commandId, int bpm, int secondsAgo) {
        jdbc.update(
                "UPDATE session_control_events SET result='APPLIED',"
                        + " applied_at = now() - make_interval(secs => ?) WHERE id=?",
                (double) secondsAgo,
                commandId);
        jdbc.update(
                "UPDATE running_sessions SET state_version=state_version+1, current_bpm=? WHERE id=?",
                bpm,
                sessionId);
    }

    @Test
    void 감속_권고_뒤_다른_코칭을_보내면_다음_감속_권고는_다시_바로_보낸다() {
        long sessionId = earlySession();
        respondChange(true, PaceDecision.Action.EASE_OFF, "430.00", 158);
        applied(sessionId, service.issueIfDue(sessionId).orElseThrow().getId(), 158, 40);
        // 감속이 아닌 변경을 보내 기억을 지운다.
        respondChange(true, PaceDecision.Action.GUIDE_PACE, "420.00", 160);
        applied(sessionId, service.issueIfDue(sessionId).orElseThrow().getId(), 160, 5);

        // 마지막 적용 5초 뒤지만 첫 감속 권고로 보고 바로 보낸다.
        respondChange(true, PaceDecision.Action.EASE_OFF, "425.00", 158);
        assertThat(service.issueIfDue(sessionId)).isPresent();
        assertThat(coachingCount(sessionId)).isEqualTo(3);
    }

    // ---- AC-6 AI 호출 중 상태 변경 ----

    private void assertDiscardedWhenDuringCall(Consumer<Long> change) {
        long sessionId = sessionOfNewUser();
        AtomicReference<Long> target = new AtomicReference<>(sessionId);
        paceDecider.respond(
                request -> {
                    change.accept(target.get());
                    return FakePaceDecider.keepGuide(request);
                });

        assertThat(service.issueIfDue(sessionId)).isEmpty();
        assertThat(coachingCount(sessionId)).isZero();
        assertThat(paceDecider.requests()).hasSize(1);
        paceDecider.reset();
    }

    @Test
    void AI_호출_중_일시정지_수동BPM_종료_폰인계_다른명령이면_버린다() {
        // 일시정지
        assertDiscardedWhenDuringCall(
                id -> jdbc.update(
                        "UPDATE running_sessions SET status='PAUSED', state_version=state_version+1 WHERE id=?",
                        id));
        // 수동 BPM 적용
        assertDiscardedWhenDuringCall(
                id -> jdbc.update(
                        "UPDATE running_sessions SET current_bpm=170, state_version=state_version+1 WHERE id=?",
                        id));
        // 종료
        assertDiscardedWhenDuringCall(
                id -> jdbc.update(
                        "UPDATE running_sessions SET status='COMPLETED', ended_at=now(),"
                                + " state_version=state_version+1 WHERE id=?",
                        id));
        // 폰 인계
        assertDiscardedWhenDuringCall(
                id -> jdbc.update(
                        "UPDATE running_sessions SET control_device_id=relay_device_id,"
                                + " state_version=state_version+1 WHERE id=?",
                        id));
        // 건강정보 동의 철회
        assertDiscardedWhenDuringCall(
                id -> jdbc.update(
                        "UPDATE users SET health_data_access='DISAGREE'"
                                + " WHERE id=(SELECT user_id FROM running_sessions WHERE id=?)",
                        id));
        // 세션 삭제
        assertDiscardedWhenDuringCall(
                id -> jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", id));
        // 그룹 러닝 종료
        assertDiscardedWhenDuringCall(
                id -> {
                    long owner =
                            jdbc.queryForObject(
                                    "SELECT user_id FROM running_sessions WHERE id=?", Long.class, id);
                    joinGroup(insertGroupRun("COMPLETED", true), owner, id);
                });
        // 버전은 같지만 다른 명령이 미확정
        assertDiscardedWhenDuringCall(
                id -> jdbc.update(
                        """
                        INSERT INTO session_control_events(session_id,device_id,action,target_bpm,expected_version,result)
                        SELECT id, control_device_id, 'SET_BPM', 165, state_version, 'PENDING'
                        FROM running_sessions WHERE id=?
                        """,
                        id));
    }

    // ---- AC-8 AI 호출 중 세션 잠금 ----

    @Test
    void AI_호출_중에는_세션_잠금을_잡지_않는다() {
        long sessionId = dueSession();
        AtomicReference<Throwable> lockFailure = new AtomicReference<>();
        paceDecider.respond(
                request -> {
                    try {
                        // 다른 커넥션에서 즉시 잠금을 얻을 수 있어야 한다(NOWAIT).
                        jdbc.queryForObject(
                                "SELECT id FROM running_sessions WHERE id=? FOR UPDATE NOWAIT",
                                Long.class,
                                sessionId);
                    } catch (RuntimeException e) {
                        lockFailure.set(e);
                    }
                    return FakePaceDecider.keepGuide(request);
                });

        assertThat(service.issueIfDue(sessionId)).isPresent();
        assertThat(lockFailure.get()).isNull();
    }
}
