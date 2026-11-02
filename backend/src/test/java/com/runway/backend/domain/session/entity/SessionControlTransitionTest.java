package com.runway.backend.domain.session.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** 실제 적용·거절 확정·취소의 상태 전이와 버전 — 작업 계획 3.2 RESULT 처리 5단계. */
class SessionControlTransitionTest {

    private static final Instant NOW = Instant.parse("2026-11-02T00:00:00Z");
    private static final Instant T1 = Instant.parse("2026-11-02T00:00:01Z");
    private static final Instant T2 = Instant.parse("2026-11-02T00:10:00Z");

    private static RunningSession ready() {
        return RunningSession.ready(1L, 101L, 102L, new SessionGoal(null, null, null, null, null), NOW);
    }

    @Test
    void 시작_적용은_RUNNING과_실제_시작시각() {
        RunningSession session = ready();

        session.applyControl(ControlAction.START, T1, NOW);

        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.RUNNING);
        assertThat(session.getStartedAt()).isEqualTo(T1);
        assertThat(session.getStateVersion()).isEqualTo(2);
    }

    @Test
    void 일시정지_재개_종료_연쇄() {
        RunningSession session = ready();
        session.applyControl(ControlAction.START, T1, NOW);

        session.applyControl(ControlAction.PAUSE, T1, NOW);
        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.PAUSED);
        session.applyControl(ControlAction.RESUME, T1, NOW);
        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.RUNNING);
        session.applyControl(ControlAction.END, T2, NOW);

        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.COMPLETED);
        assertThat(session.getEndedAt()).isEqualTo(T2);
        assertThat(session.getStartedAt()).isEqualTo(T1);
        assertThat(session.getStateVersion()).isEqualTo(5);
    }

    @Test
    void 일시정지에서도_종료할_수_있다() {
        RunningSession session = ready();
        session.applyControl(ControlAction.START, T1, NOW);
        session.applyControl(ControlAction.PAUSE, T1, NOW);

        session.applyControl(ControlAction.END, T2, NOW);

        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.COMPLETED);
    }

    @Test
    void 허용되지_않은_출발_상태의_적용은_예외() {
        RunningSession session = ready();

        assertThatThrownBy(() -> session.applyControl(ControlAction.PAUSE, T1, NOW))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> session.applyControl(ControlAction.SET_BPM, T1, NOW))
                .isInstanceOf(IllegalStateException.class);
        assertThat(session.getStateVersion()).isEqualTo(1);
    }

    @Test
    void 거절_확정은_상태를_유지하고_버전만_올린다() {
        RunningSession session = ready();

        session.confirmRejection(NOW);

        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.READY);
        assertThat(session.getStartedAt()).isNull();
        assertThat(session.getStateVersion()).isEqualTo(2);
    }

    @Test
    void 준비_취소는_CANCELLED와_버전_증가() {
        RunningSession session = ready();

        session.cancel(NOW);

        assertThat(session.getStatus()).isEqualTo(RunningSessionStatus.CANCELLED);
        assertThat(session.getStateVersion()).isEqualTo(2);
    }

    @Test
    void 준비가_아니면_취소는_예외() {
        RunningSession session = ready();
        session.applyControl(ControlAction.START, T1, NOW);

        assertThatThrownBy(() -> session.cancel(NOW)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 작업별_승인_가능_상태표() {
        Map<ControlAction, Set<RunningSessionStatus>> allowed =
                Map.of(
                        ControlAction.START, Set.of(RunningSessionStatus.READY),
                        ControlAction.PAUSE, Set.of(RunningSessionStatus.RUNNING),
                        ControlAction.RESUME, Set.of(RunningSessionStatus.PAUSED),
                        ControlAction.END,
                                Set.of(RunningSessionStatus.RUNNING, RunningSessionStatus.PAUSED));
        for (var entry : allowed.entrySet()) {
            for (RunningSessionStatus status : RunningSessionStatus.values()) {
                assertThat(RunningSession.canApprove(entry.getKey(), status))
                        .as("%s from %s", entry.getKey(), status)
                        .isEqualTo(entry.getValue().contains(status));
            }
        }
    }

    @Test
    void 명령은_PENDING으로_만들어지고_결과를_기록한다() {
        SessionControlEvent event = SessionControlEvent.request(7L, 101L, ControlAction.START, 1L, NOW);

        assertThat(event.getResult()).isEqualTo(ControlResult.PENDING);
        assertThat(event.getTargetBpm()).isNull();
        assertThat(event.getCoachingId()).isNull();
        assertThat(event.getCreatedAt()).isEqualTo(NOW);
        assertThat(event.isConfirmed()).isFalse();

        event.recordResult(ControlResult.APPLIED, T1, null);

        assertThat(event.getResult()).isEqualTo(ControlResult.APPLIED);
        assertThat(event.getAppliedAt()).isEqualTo(T1);
        assertThat(event.isConfirmed()).isTrue();
    }

    @Test
    void 미확인_기록은_확정이_아니다() {
        SessionControlEvent event = SessionControlEvent.request(7L, 101L, ControlAction.PAUSE, 2L, NOW);

        event.recordResult(ControlResult.UNKNOWN, null, "EXERCISE_CALL_TIMEOUT");

        assertThat(event.getResult()).isEqualTo(ControlResult.UNKNOWN);
        assertThat(event.getReasonCode()).isEqualTo("EXERCISE_CALL_TIMEOUT");
        assertThat(event.isConfirmed()).isFalse();
        assertThat(event.isUnconfirmed()).isTrue();
    }

    @Test
    void 같은_결과_비교는_결과_시각_사유를_모두_본다() {
        SessionControlEvent event = SessionControlEvent.request(7L, 101L, ControlAction.START, 1L, NOW);
        event.recordResult(ControlResult.APPLIED, T1, null);

        assertThat(event.sameOutcome(ControlResult.APPLIED, T1, null)).isTrue();
        assertThat(event.sameOutcome(ControlResult.APPLIED, T2, null)).isFalse();
        assertThat(event.sameOutcome(ControlResult.REJECTED, null, null)).isFalse();
        assertThat(event.sameOutcome(ControlResult.APPLIED, T1, "X")).isFalse();
    }
}
