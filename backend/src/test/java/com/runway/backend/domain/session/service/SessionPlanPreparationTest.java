package com.runway.backend.domain.session.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.SessionPlanSourceRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * S15P31E105-880: 소수 거리 저장 코스(4004.90 m)로 러닝을 시작하면 앱은 정수 목표 거리(Math.round = 4005)를 보내고, AI09는
 * 코스 거리(4004.9)로 계획을 돌려준다. 계획 검증 기준 거리가 코스 거리여야 계획이 채택된다.
 */
class SessionPlanPreparationTest {
    private static final long USER = 7L;
    private static final long COURSE = 31L;
    private static final BigDecimal COURSE_DISTANCE = new BigDecimal("4004.90");

    private final SessionPlanSourceRepository source = mock(SessionPlanSourceRepository.class);
    private final PersonalPacePlanPort port = mock(PersonalPacePlanPort.class);
    private final SegmentDifficultyProvider difficulty = mock(SegmentDifficultyProvider.class);
    private final SessionAccess access = mock(SessionAccess.class);
    private final SessionPlanPreparation preparation =
            new SessionPlanPreparation(source, port, difficulty, access);

    @BeforeEach
    void setUp() {
        when(source.course(COURSE))
                .thenReturn(
                        Optional.of(
                                new SessionPlanSourceRepository.Course(
                                        COURSE_DISTANCE, "stamp", "ACTIVE")));
        when(source.consent(anyLong()))
                .thenReturn(Optional.of(new SessionPlanSourceRepository.Consent(true, "u")));
    }

    /** AI09 응답(ai/service personal_plan.finalize_personal_segments_with_clamp, 4004.9 m, 목표 없음)을 그대로 옮긴 값. */
    private static PersonalPacePlanPort.Result ai09Plan() {
        return new PersonalPacePlanPort.Result(
                COURSE,
                USER,
                new BigDecimal("4004.9"),
                new BigDecimal("379.07785462808056"),
                List.of(
                        segment(1, "0.0", "1000.0", "372.4", "0.982384"),
                        segment(2, "1000.0", "2000.0", "381.9", "1.007445"),
                        segment(3, "2000.0", "3000.0", "395.3", "1.042794"),
                        segment(4, "3000.0", "4000.0", "366.8", "0.967611"),
                        segment(5, "4000.0", "4004.9", "361.0", "0.952311")));
    }

    private static PersonalPacePlanPort.Segment segment(
            int sequence, String start, String end, String pace, String ratio) {
        return new PersonalPacePlanPort.Segment(
                sequence,
                new BigDecimal(start),
                new BigDecimal(end),
                new BigDecimal(pace),
                new BigDecimal(ratio));
    }

    @Test
    void decimalCourseWithRoundedGoalDistanceKeepsAi09Plan() {
        // 앱 goalConfig: 코스 러닝 목표 거리 = Math.round(4004.90) = 4005.
        SessionGoal goal = new SessionGoal(COURSE, null, 4005, null, null);
        when(port.plan(USER, goal)).thenReturn(Optional.of(ai09Plan()));

        var prepared = preparation.prepare(USER, goal);

        assertThat(prepared.personalResult()).isTrue();
        assertThat(prepared.draft()).isPresent();
        var draft = prepared.draft().orElseThrow();
        assertThat(draft.paceSecPerKm()).isEqualByComparingTo("379.08");
        assertThat(draft.segments()).hasSize(5);
        assertThat(draft.segments().get(4).endDistanceM()).isEqualByComparingTo("4004.9");
    }

    @Test
    void courseWithoutGoalDistanceStillUsesCourseDistance() {
        SessionGoal goal = new SessionGoal(COURSE, null, null, null, null);
        when(port.plan(USER, goal)).thenReturn(Optional.of(ai09Plan()));

        assertThat(preparation.prepare(USER, goal).draft()).isPresent();
    }

    @Test
    void goalDistanceFarFromCourseKeepsGoalDistanceAsBefore() {
        // 코스 반올림(1 m 이내)이 아닌 목표 거리는 예전 기준(목표 거리) 그대로다.
        SessionGoal goal = new SessionGoal(COURSE, null, 1000, null, null);
        when(port.plan(USER, goal))
                .thenReturn(
                        Optional.of(
                                new PersonalPacePlanPort.Result(
                                        COURSE,
                                        USER,
                                        new BigDecimal("1000"),
                                        new BigDecimal("360"),
                                        List.of(segment(1, "0", "1000", "360", "1")))));

        assertThat(preparation.prepare(USER, goal).draft()).isPresent();
    }

    @Test
    void unavailableAi09StillRejectsCourseRun() {
        SessionGoal goal = new SessionGoal(COURSE, null, 4005, null, null);
        when(port.plan(any(), any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> preparation.prepare(USER, goal))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).errorCode())
                .isEqualTo(ErrorCode.SERVICE_UNAVAILABLE);
    }
}
