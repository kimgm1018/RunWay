package com.runway.backend.domain.grouprun.pace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.runway.backend.domain.grouprun.repository.*;
import com.runway.backend.domain.session.repository.*;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;
import com.runway.backend.domain.session.service.SegmentDifficultyProvider;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import java.util.Optional;
import java.time.Instant;
import java.math.BigDecimal;

class GroupPaceServiceTest {
    @Test
    void disabled_neverReadsWritesPublishesOrCallsAi() {
        var states = mock(GroupPaceRepository.class);
        var groups = mock(GroupRunJdbcRepository.class);
        var participants = mock(GroupRunParticipantJdbcRepository.class);
        var coaching = mock(SessionCoachingRepository.class);
        var references = mock(SessionReferenceRepository.class);
        var ai = mock(GroupPacePort.class);
        var plans = mock(PersonalPacePlanPort.class);
        var events = mock(ApplicationEventPublisher.class);
        var transactions = mock(PlatformTransactionManager.class);
        var service = new GroupPaceService(false, 0, "", states, groups, participants, coaching, references,
                ai, plans, events, JsonMapper.builder().build(), transactions, mock(com.runway.backend.domain.grouprun.repository.GroupRunFitJdbcRepository.class), mock(SegmentDifficultyProvider.class));
        service.membershipOrGoalChanged(7);
        service.onBatch(8);
        service.evaluateRunning(7);
        assertThat(service.evaluateStart(7)).isFalse();
        // S15P31E105-817: 기능이 꺼져 있으면 기동 재계산 대상도 테이블을 읽지 않고 비어 있다.
        assertThat(service.startBackfillTargets(100)).isEmpty();
        assertThat(service.stored(7)).isEmpty();
        verifyNoInteractions(states, groups, participants, coaching, references, ai, plans,
                events, transactions);
    }

    @Test
    void selection_takesThreeSlowestAndAllNoRecordUsers() {
        var selected = GroupPaceService.selectSlowest(List.of(ranked(1, 300), ranked(2, 310),
                ranked(3, 400), ranked(4, 350), ranked(5, 500), ranked(6, null), ranked(7, null)));
        assertThat(selected).extracting(r -> r.candidate().userId())
                .containsExactly(6L, 7L, 5L, 3L, 4L);
    }

    private GroupPaceService.Ranked ranked(long userId, Integer recent) {
        return new GroupPaceService.Ranked(new GroupPaceRepository.Candidate(userId, true, null), recent);
    }

    @Test
    void failedAi_neverOverwritesPreviousState() {
        var fixture = new RunningFixture();
        when(fixture.ai.evaluate(any())).thenReturn(Optional.empty());
        fixture.service.evaluateRunning(7);
        verify(fixture.ai).evaluate(any());
        verify(fixture.states, never()).saveRunning(anyLong(), any(), any(), any());
    }

    @Test
    void success_persistsUsingAcquiredTokenAndStoredCurrentPace() {
        var fixture = new RunningFixture();
        var result = new GroupPacePort.Result(390, true, "SLOW", "HR_LIMIT", 1, 0, 0,
                List.of(), "test");
        when(fixture.ai.evaluate(any())).thenReturn(Optional.of(result));
        fixture.service.evaluateRunning(7);
        var capture = org.mockito.ArgumentCaptor.forClass(GroupPacePort.Request.class);
        verify(fixture.ai).evaluate(capture.capture());
        assertThat(capture.getValue().currentGroupPaceSecPerKm()).isEqualTo(375);
        verify(fixture.states).saveRunning(eq(7L), eq(fixture.token), eq(result), any());
    }

    @Test
    void supersededSnapshot_doesNotCallAiEvenAfterLongPreparation() {
        var fixture = new RunningFixture();
        when(fixture.states.reserve(7, fixture.token)).thenReturn(Optional.empty());
        fixture.service.evaluateRunning(7);
        verifyNoInteractions(fixture.ai);
        var order = inOrder(fixture.coaching, fixture.states);
        order.verify(fixture.states).find(7);
        order.verify(fixture.states).runners(7);
        order.verify(fixture.coaching).recentSamples(8, 1800, true);
        order.verify(fixture.states).consented(9);
        order.verify(fixture.states).reserve(7, fixture.token);
    }

    @Test
    void consentRevokedWhileAssemblingOtherRunners_doesNotTransmitHealthData() {
        var fixture = new RunningFixture();
        when(fixture.states.consented(9)).thenReturn(false);
        fixture.service.evaluateRunning(7);
        verifyNoInteractions(fixture.ai);
        verify(fixture.states, never()).reserve(anyLong(), any());
    }

    @Test
    void preRun_rechecksLaterParticipantsConsentAfterEarlierAiCall() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.consented(10)).thenReturn(true);
        when(fixture.plans.plan(eq(9L), any())).thenAnswer(invocation -> {
            when(fixture.states.consented(10)).thenReturn(false);
            return Optional.of(new PersonalPacePlanPort.Result(null, 9L,
                    BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of()));
        });
        fixture.service.evaluateStart(7);
        verify(fixture.plans, never()).plan(eq(10L), any());
        verify(fixture.states, never()).saveStart(anyLong(), any(), any());
    }

    @Test
    void preRun_allNonConsentDoesNotCallPlansOrSave() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, false, BigDecimal.valueOf(330)),
                new GroupPaceRepository.Candidate(10, false, null)));
        fixture.service.evaluateStart(7);
        verifyNoInteractions(fixture.plans);
        verify(fixture.states, never()).saveStart(anyLong(), any(), any());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.NullSource
    @org.junit.jupiter.params.provider.ValueSource(ints = 900)
    void preRun_nonConsenterDoesNotDisplaceConsentingCandidatesOrAffectPace(Integer recent) {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null),
                new GroupPaceRepository.Candidate(11, true, null),
                new GroupPaceRepository.Candidate(12, true, null),
                new GroupPaceRepository.Candidate(13, true, null),
                new GroupPaceRepository.Candidate(14, false, BigDecimal.valueOf(900))));
        for (long user = 9; user <= 12; user++) {
            when(fixture.states.recentPaces(user, 5000))
                    .thenReturn(List.of(BigDecimal.valueOf(300 + (user - 9) * 10)));
        }
        when(fixture.states.recentPaces(14, 5000)).thenReturn(
                recent == null ? List.of() : List.of(BigDecimal.valueOf(recent)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.plans.plan(anyLong(), any())).thenAnswer(invocation -> Optional.of(
                new PersonalPacePlanPort.Result(null, invocation.getArgument(0),
                        BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));

        fixture.service.evaluateStart(7);

        verify(fixture.plans).plan(eq(13L), any());
        verify(fixture.plans).plan(eq(12L), any());
        verify(fixture.plans).plan(eq(11L), any());
        verify(fixture.plans).plan(eq(10L), any());
        verifyNoMoreInteractions(fixture.plans);
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(410, 410, 13, 4, uniformStartSegments()));
    }

    // S15P31E105-785: 기준 참가자의 AI09 계획이 탐색 범위 끝에 걸렸고 그 사람의 최근 페이스(편한 범위에 들어가는 본인 값)가 더
    // 느릴 때만, 추천을 그 본인 페이스로 내린다. 비동의 참가자의 기록은 쓰지 않는다.
    private static void clampCase(RunningFixture fixture, boolean boundaryHit, int basisRecent) {
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null),
                new GroupPaceRepository.Candidate(11, false, null)));
        when(fixture.states.recentPaces(9, 5000)).thenReturn(List.of(BigDecimal.valueOf(basisRecent)));
        when(fixture.states.recentPaces(10, 5000)).thenReturn(List.of(BigDecimal.valueOf(400)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.fits.findRecentCompletedPaces(List.of(9L, 10L))).thenReturn(java.util.Map.of(
                9L, List.of(BigDecimal.valueOf(basisRecent)), 10L, List.of(BigDecimal.valueOf(400))));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 9L, BigDecimal.valueOf(5000), BigDecimal.valueOf(433), List.of(), boundaryHit)));
        when(fixture.plans.plan(eq(10L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 10L, BigDecimal.valueOf(5000), BigDecimal.valueOf(380), List.of(), false)));
        fixture.service.evaluateStart(7);
    }

    @Test
    void preRun_boundaryHitAndBasisSlowerThanPlan_clampsToBasisOwnPace() {
        var fixture = new RunningFixture();
        clampCase(fixture, true, 1000);
        verify(fixture.states).saveStart(7, fixture.token, new GroupPaceRepository.Start(1000, 1000, 9, 2, uniformStartSegments()));
        // 비동의 참가자(11)의 기록은 읽지 않는다.
        verify(fixture.fits).findRecentCompletedPaces(List.of(9L, 10L));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"false,1000", "true,420"})
    void preRun_noBoundaryHitOrBasisNotSlower_keepsAiPace(boolean boundaryHit, int basisRecent) {
        var fixture = new RunningFixture();
        clampCase(fixture, boundaryHit, basisRecent);
        verify(fixture.states).saveStart(7, fixture.token, new GroupPaceRepository.Start(433, 433, 9, 2, uniformStartSegments()));
    }

    // S15P31E105-886 재현: 기준 본인 페이스가 상식 밖(0.5 m/s = 2000초/km보다 느림, 예: 운영 185'27")이면 내리지 않고 AI09 값을 둔다.
    @Test
    void preRun_implausibleBasisPace_isNotUsedAsClampTarget() {
        var fixture = new RunningFixture();
        clampCase(fixture, true, 11127);
        verify(fixture.states).saveStart(7, fixture.token, new GroupPaceRepository.Start(433, 433, 9, 2, uniformStartSegments()));
    }

    // 다른 참가자의 더 느린 기록은 clamp 목표가 되지 않는다: 기준(9)이 500이면 10의 900이 아니라 500.
    @Test
    void preRun_slowerOtherMember_doesNotBecomeTheTarget() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.recentPaces(9, 5000)).thenReturn(List.of(BigDecimal.valueOf(500)));
        when(fixture.states.recentPaces(10, 5000)).thenReturn(List.of(BigDecimal.valueOf(900)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.fits.findRecentCompletedPaces(any())).thenReturn(java.util.Map.of(
                9L, List.of(BigDecimal.valueOf(500)), 10L, List.of(BigDecimal.valueOf(900))));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 9L, BigDecimal.valueOf(5000), BigDecimal.valueOf(433), List.of(), true)));
        when(fixture.plans.plan(eq(10L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 10L, BigDecimal.valueOf(5000), BigDecimal.valueOf(420), List.of(), false)));
        fixture.service.evaluateStart(7);
        verify(fixture.states).saveStart(7, fixture.token, new GroupPaceRepository.Start(500, 500, 9, 2, uniformStartSegments()));
    }

    // 혼자인 그룹런도 기준 본인의 페이스로 내린다. 739 km 구간 비율은 clamp 뒤에도 그대로 저장된다.
    @Test
    void preRun_singleMemberClamp_keepsSegmentRatios() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(new GroupPaceRepository.Candidate(9, true, null)));
        when(fixture.states.recentPaces(9, 5000)).thenReturn(List.of(BigDecimal.valueOf(1000)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.fits.findRecentCompletedPaces(any())).thenReturn(java.util.Map.of(
                9L, List.of(BigDecimal.valueOf(1000))));
        var segments = List.of(seg5(1, 0, 1000, "1.02"), seg5(2, 1000, 2000, "1.00"), seg5(3, 2000, 3000, "0.99"),
                seg5(4, 3000, 4000, "1.00"), seg5(5, 4000, 5000, "0.99"));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 9L, BigDecimal.valueOf(5000), BigDecimal.valueOf(433), segments, true)));
        fixture.service.evaluateStart(7);
        var saved = org.mockito.ArgumentCaptor.forClass(GroupPaceRepository.Start.class);
        verify(fixture.states).saveStart(eq(7L), eq(fixture.token), saved.capture());
        assertThat(saved.getValue().pace()).isEqualTo(1000);
        assertThat(saved.getValue().aiPace()).isEqualTo(1000);
        assertThat(saved.getValue().segments()).extracting(GroupPaceRepository.SegmentRatio::ratio)
                .containsExactly(new BigDecimal("1.02"), new BigDecimal("1.00"), new BigDecimal("0.99"),
                        new BigDecimal("1.00"), new BigDecimal("0.99"));
    }

    @Test
    void preRun_coursePlanUsesFullCourseLengthAndKeepsHostGoalPace() {
        var fixture = new RunningFixture();
        when(fixture.groups.findById(7)).thenReturn(Optional.of(new GroupRunRow(7, 1, 9, 12L,
                "test", null, fixture.token, null, null, null, 5000, 1800, "SCHEDULED", null,
                fixture.token, fixture.token)));
        when(fixture.states.find(7)).thenReturn(Optional.of(modeState("GOAL", fixture.token)));
        when(fixture.states.candidates(7)).thenReturn(List.of(new GroupPaceRepository.Candidate(9, true, null)));
        var distance = BigDecimal.valueOf(2500);
        when(fixture.coaching.courseGrade(12)).thenReturn(Optional.of(
                new SessionCoachingRepository.CourseGrade(distance,
                        "[{\"startDistanceM\":0,\"endDistanceM\":2500,\"gradePercent\":3}]")));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                12L, 9L, distance, BigDecimal.valueOf(400), List.of(seg(1, 0, 1000, "1.02"),
                        seg(2, 1000, 2000, "1.00"), seg(3, 2000, 2500, "0.96")))));

        fixture.service.evaluateStart(7);

        verify(fixture.plans).plan(9L,
                new com.runway.backend.domain.session.entity.SessionGoal(12L, null, null, null, null));
        var saved = org.mockito.ArgumentCaptor.forClass(GroupPaceRepository.Start.class);
        verify(fixture.states).saveStart(eq(7L), eq(fixture.token), saved.capture());
        assertThat(saved.getValue().pace()).isEqualTo(360);
        assertThat(saved.getValue().segments()).extracting(GroupPaceRepository.SegmentRatio::endDistanceM)
                .containsExactly(BigDecimal.valueOf(1000), BigDecimal.valueOf(2000), distance);
    }

    @Test
    void preRun_missingAiRatiosSavesStoredDifficultyWeightedBySegmentLength() {
        var fixture = new RunningFixture();
        when(fixture.groups.findById(7)).thenReturn(Optional.of(new GroupRunRow(7, 1, 9, 12L,
                "test", null, fixture.token, null, null, null, 5000, 1800, "SCHEDULED", null,
                fixture.token, fixture.token)));
        when(fixture.states.candidates(7)).thenReturn(List.of(new GroupPaceRepository.Candidate(9, true, null)));
        var distance = BigDecimal.valueOf(2500);
        when(fixture.coaching.courseGrade(12)).thenReturn(Optional.of(
                new SessionCoachingRepository.CourseGrade(distance, null)));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(12L, 9L, distance, BigDecimal.valueOf(400), List.of())));
        when(fixture.difficulty.ratios(12L, distance, 3)).thenReturn(Optional.of(List.of(
                BigDecimal.valueOf(102), BigDecimal.valueOf(100), BigDecimal.valueOf(96))));

        fixture.service.evaluateStart(7);

        var saved = org.mockito.ArgumentCaptor.forClass(GroupPaceRepository.Start.class);
        verify(fixture.states).saveStart(eq(7L), eq(fixture.token), saved.capture());
        assertThat(saved.getValue().segments()).containsExactly(
                new GroupPaceRepository.SegmentRatio(BigDecimal.ZERO, BigDecimal.valueOf(1000), new BigDecimal("1.02")),
                new GroupPaceRepository.SegmentRatio(BigDecimal.valueOf(1000), BigDecimal.valueOf(2000), BigDecimal.ONE),
                new GroupPaceRepository.SegmentRatio(BigDecimal.valueOf(2000), distance, new BigDecimal("0.96")));
    }

    // S15P31E105-803: GOAL 모드에서도 clamp 경로를 탄다. 적용 페이스는 방장 목표(5000 m / 1800 s = 360)이고, 내린 AI 추천(1000)과
    // 기준 회원은 그대로 저장한다. 목표보다 느린 회원 수는 원래 AI09 계획(433·380 모두 360보다 느림)으로 센다.
    @Test
    void preRun_goalModeClamp_appliesGoalAndStoresClampedAiPace() {
        var fixture = new RunningFixture();
        when(fixture.states.find(7)).thenReturn(Optional.of(modeState("GOAL", fixture.token)));
        clampCase(fixture, true, 1000);
        verify(fixture.states).saveStart(7, fixture.token, new GroupPaceRepository.Start(360, 1000, 9, 2, uniformStartSegments()));
    }

    // S15P31E105-803 7번: 기준 회원(9)의 원래 계획 350은 목표 360보다 빨라 느린 회원 수에 들지 않지만, 탐색 하한에 걸려 본인 최근
    // 페이스 400으로 내리면 AI 추천은 목표보다 느려진다. 느린 회원 수는 원래 계획 기준이라 0으로 남는다(동작 유지, 문서화).
    @Test
    void preRun_goalModeClampBelowGoal_slowerCountUsesOriginalAiPlans() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.find(7)).thenReturn(Optional.of(modeState("GOAL", fixture.token)));
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.recentPaces(9, 5000)).thenReturn(List.of(BigDecimal.valueOf(400)));
        when(fixture.states.recentPaces(10, 5000)).thenReturn(List.of(BigDecimal.valueOf(330)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.fits.findRecentCompletedPaces(any())).thenReturn(java.util.Map.of(
                9L, List.of(BigDecimal.valueOf(400)), 10L, List.of(BigDecimal.valueOf(330))));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 9L, BigDecimal.valueOf(5000), BigDecimal.valueOf(350), List.of(), true)));
        when(fixture.plans.plan(eq(10L), any())).thenReturn(Optional.of(new PersonalPacePlanPort.Result(
                null, 10L, BigDecimal.valueOf(5000), BigDecimal.valueOf(340), List.of(), false)));
        fixture.service.evaluateStart(7);
        verify(fixture.states).saveStart(7, fixture.token, new GroupPaceRepository.Start(360, 400, 9, 0, uniformStartSegments()));
    }

    private static PersonalPacePlanPort.Segment seg5(int n, long start, long end, String ratio) {
        return new PersonalPacePlanPort.Segment(n, BigDecimal.valueOf(start), BigDecimal.valueOf(end),
                BigDecimal.valueOf(433).multiply(new BigDecimal(ratio)), new BigDecimal(ratio));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void preRun_supersededOrMissingStateStopsRemainingCallsWithoutSaving(boolean missing) {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.consented(10)).thenReturn(true);
        when(fixture.plans.plan(eq(9L), any())).thenAnswer(invocation -> {
            when(fixture.states.find(7)).thenReturn(missing ? Optional.empty() : Optional.of(
                    new GroupPaceRepository.State(null, null, null, null, 0,
                            fixture.token.plusSeconds(1))));
            return Optional.of(new PersonalPacePlanPort.Result(null, 9L,
                    BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of()));
        });

        fixture.service.evaluateStart(7);

        verify(fixture.plans).plan(eq(9L), any());
        verifyNoMoreInteractions(fixture.plans);
        verify(fixture.states, never()).saveStart(anyLong(), any(), any());
    }

    @org.junit.jupiter.params.ParameterizedTest
    // S15P31E105-702: TOGETHER applies the AI recommendation as it is, even when the host's goal (360) is slower.
    @org.junit.jupiter.params.provider.CsvSource({"330,330,0", "410,410,1"})
    void preRun_togetherAppliesSlowestPlanEvenWhenGoalIsSlower(int plannedPace, int expected, int slower) {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.consented(10)).thenReturn(true);
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 9L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(320), List.of())));
        when(fixture.plans.plan(eq(10L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 10L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(plannedPace), List.of())));

        fixture.service.evaluateStart(7);

        verify(fixture.plans).plan(eq(9L), any());
        verify(fixture.plans).plan(eq(10L), any());
        verifyNoMoreInteractions(fixture.plans);
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(expected, plannedPace, 10, slower, uniformStartSegments()));
    }

    // S15P31E105-914: 시연용 출발 추천 고정. 9번(시연 회원)과 10번(일반)이 함께 있는 방에서 AI09 계획은 각각 330·410이다.
    private void demoStart(RunningFixture fixture, String mode) {
        fixture.scheduled();
        if (mode != null) {
            when(fixture.states.find(7)).thenReturn(Optional.of(modeState(mode, fixture.token)));
        }
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 9L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(330), List.of())));
        when(fixture.plans.plan(eq(10L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 10L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(410), List.of())));
        fixture.service.evaluateStart(7);
    }

    @Test
    void demoStart_togetherWithDemoMember_fixesAppliedAndAiPaceToConfiguredValue() {
        var fixture = new RunningFixture(540, " 9 , 12 ");
        demoStart(fixture, null);
        // 적용·AI 추천 모두 540. 기준 회원(10)·느린 회원 수(목표 360보다 느린 계획 1개, 410)는 원래 계산 그대로.
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(540, 540, 10, 1, uniformStartSegments()));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
            "0,'9'", // 설정값 0 = 끔
            "540,''", // 시연 회원 목록이 비어 있음
            "540,'11,12'", // 방에 시연 회원이 없음
            "100,'9'", // 240 미만은 무시
            "901,'9'", // 900 초과는 무시
            "540,'abc'"}) // 숫자가 아닌 항목은 건너뜀
    void demoStart_offOrNoDemoMemberOrOutOfRange_keepsAiPace(int pace, String ids) {
        var fixture = new RunningFixture(pace, ids);
        demoStart(fixture, null);
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(410, 410, 10, 1, uniformStartSegments()));
    }

    @Test
    void demoStart_goalMode_keepsGoalAndAiPace() {
        var fixture = new RunningFixture(540, "9");
        demoStart(fixture, "GOAL");
        // GOAL 모드는 방장 목표(5000 m / 1800 s = 360)를 적용하고 AI 추천도 고정하지 않는다.
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(360, 410, 10, 1, uniformStartSegments()));
    }

    @Test
    void demoStart_nonConsentingDemoMember_doesNotTrigger() {
        var fixture = new RunningFixture(540, "11");
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(11, false, null)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 9L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(410), List.of())));
        fixture.service.evaluateStart(7);
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(410, 410, 9, 1, uniformStartSegments()));
    }

    @Test
    void demoStart_parseUserIds_skipsBlankAndInvalidEntries() {
        assertThat(GroupPaceService.parseUserIds(" 11, ,12,x,13 ")).containsExactlyInAnyOrder(11L, 12L, 13L);
        assertThat(GroupPaceService.parseUserIds(null)).isEmpty();
        assertThat(GroupPaceService.parseUserIds("")).isEmpty();
    }

    private static GroupPaceRepository.State modeState(String mode, Instant token) {
        return new GroupPaceRepository.State(375, 380, "SLOW", token, 1, token, mode, null, null,
                null, null, null, false);
    }

    @Test
    void preRun_goalModeAppliesGoalButKeepsAiRecommendationBasisAndSlowerCount() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.find(7)).thenReturn(Optional.of(modeState("GOAL", fixture.token)));
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null),
                new GroupPaceRepository.Candidate(10, true, null)));
        when(fixture.states.consented(anyLong())).thenReturn(true);
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 9L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(420), List.of())));
        when(fixture.plans.plan(eq(10L), any())).thenReturn(Optional.of(
                new PersonalPacePlanPort.Result(null, 10L, BigDecimal.valueOf(5000),
                        BigDecimal.valueOf(380), List.of())));

        fixture.service.evaluateStart(7);

        // Goal 5000 m / 1800 s = 360 s/km. Both plans are slower than the goal.
        verify(fixture.states).saveStart(7, fixture.token,
                new GroupPaceRepository.Start(360, 420, 9, 2, uniformStartSegments()));
    }

    @Test
    void preRun_failedPlanEndsCalculatingWithoutSaving() {
        var fixture = new RunningFixture();
        fixture.scheduled();
        when(fixture.states.candidates(7)).thenReturn(List.of(
                new GroupPaceRepository.Candidate(9, true, null)));
        when(fixture.plans.plan(eq(9L), any())).thenReturn(Optional.empty());

        fixture.service.evaluateStart(7);

        verify(fixture.states).abandonStart(7, fixture.token);
        verify(fixture.states, never()).saveStart(anyLong(), any(), any());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(value = {"GOAL,GOAL", "TOGETHER,"})
    void running_sendsPaceModeOnlyForGoal(String mode, String expected) {
        var fixture = new RunningFixture();
        when(fixture.states.find(7)).thenReturn(Optional.of(modeState(mode, fixture.token)));
        assertThat(fixture.request().paceMode()).isEqualTo(expected);
    }

    @Test
    void running_goalModeFirstEvaluationStartsFromGoalNotMeasuredMedian() {
        var fixture = new RunningFixture();
        when(fixture.states.find(7)).thenReturn(Optional.of(new GroupPaceRepository.State(null, 380,
                null, null, 0, fixture.token, "GOAL", 400, 9L, "a", 1, null, false)));
        // Goal 5000 m / 1800 s = 360 s/km.
        assertThat(fixture.request().currentGroupPaceSecPerKm()).isEqualTo(360);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
            "1000,2000,4500,0.4", // Odd median differs from both mean and maximum.
            "1000,3000,,0.4",    // Even median averages the two middle distances.
            "6000,7000,8000,1.0",
            "0,0,0,0.0",
            "-300,-200,-100,0.0"
    })
    void runningProgress_usesClampedMedianOfActiveParticipants(
            int first, int second, Integer third, double expected) {
        var fixture = new RunningFixture();
        var now = Instant.now();
        var runners = new java.util.ArrayList<GroupPaceRepository.Runner>();
        var live = new java.util.ArrayList<SessionReferenceRepository.GroupLiveRow>();
        var distances = new java.util.ArrayList<>(List.of(first, second));
        if (third != null) distances.add(third);
        for (int i = 0; i < distances.size(); i++) {
            runners.add(new GroupPaceRepository.Runner(20 + i, 30 + i, "RUNNING",
                    now.minusSeconds(600), false));
            live.add(new SessionReferenceRepository.GroupLiveRow(20 + i, "RUNNING", now,
                    BigDecimal.valueOf(distances.get(i)), now, null, now));
        }
        // Paused and stale participants must not affect the median.
        runners.add(new GroupPaceRepository.Runner(90, 91, "PAUSED", now, false));
        live.add(new SessionReferenceRepository.GroupLiveRow(90, "PAUSED", now,
                BigDecimal.valueOf(50000), now, null, now));
        runners.add(new GroupPaceRepository.Runner(92, 93, "RUNNING", now, false));
        live.add(new SessionReferenceRepository.GroupLiveRow(92, "RUNNING", now,
                BigDecimal.valueOf(50000), now.minusSeconds(3600), null,
                now.minusSeconds(3600)));
        when(fixture.states.runners(7)).thenReturn(runners);
        when(fixture.references.findGroupLiveRows(eq(7L), any())).thenReturn(live);
        assertThat(fixture.request().progressRatio()).isEqualTo(expected);
    }

    @Test
    void runningProgress_withoutDistanceGoalIsNull() {
        var fixture = new RunningFixture();
        fixture.goal(null, null);
        assertThat(fixture.request().progressRatio()).isNull();
    }

    @Test
    void runningProgress_courseDistanceIsGoalDistance() {
        var fixture = new RunningFixture();
        fixture.goal(42L, null);
        when(fixture.coaching.courseGrade(42)).thenReturn(Optional.of(
                new SessionCoachingRepository.CourseGrade(BigDecimal.valueOf(4000), null)));
        assertThat(fixture.request().progressRatio()).isEqualTo(0.25);
    }

    @Test
    void runningProgress_withoutActiveParticipantsIsNull() {
        var fixture = new RunningFixture();
        when(fixture.references.findGroupLiveRows(eq(7L), any())).thenReturn(List.of());
        assertThat(fixture.request().progressRatio()).isNull();
    }

    private static PersonalPacePlanPort.Segment seg(int n, long start, long end, String ratio) {
        return new PersonalPacePlanPort.Segment(n, BigDecimal.valueOf(start), BigDecimal.valueOf(end),
                BigDecimal.valueOf(400).multiply(new BigDecimal(ratio)), new BigDecimal(ratio));
    }

    private static PersonalPacePlanPort.Result plan(List<PersonalPacePlanPort.Segment> segments) {
        return new PersonalPacePlanPort.Result(null, 9L, BigDecimal.valueOf(2500), BigDecimal.valueOf(400),
                segments);
    }

    @Test
    void segmentRatios_keepsOnlyContiguousKmSegmentsInsideTheAiBound() {
        var good = GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 1000, "1.02"),
                seg(2, 1000, 2000, "1.00"), seg(3, 2000, 2500, "0.96"))), 2500);
        assertThat(good).extracting(GroupPaceRepository.SegmentRatio::ratio)
                .containsExactly(new BigDecimal("1.02"), new BigDecimal("1.00"), new BigDecimal("0.96"));
        // A gap, a ratio out of 0.85~1.20, a segment over 1 km, or a plan that stops short: none kept.
        assertThat(GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 1000, "1.00"),
                seg(2, 1200, 2500, "1.00"))), 2500)).isEmpty();
        assertThat(GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 1000, "1.30"),
                seg(2, 1000, 2000, "1.00"), seg(3, 2000, 2500, "0.90"))), 2500)).isEmpty();
        assertThat(GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 1500, "1.00"),
                seg(2, 1500, 2500, "1.00"))), 2500)).isEmpty();
        assertThat(GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 1000, "1.00"))), 2500)).isEmpty();
        assertThat(GroupPaceService.segmentRatios(plan(List.of()), 2500)).isEmpty();
        // As S01 checks: a 500 m step in the middle, ratios not averaging 1, or a pace off mean x ratio.
        assertThat(GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 500, "1.00"),
                seg(2, 500, 1500, "1.00"), seg(3, 1500, 2500, "1.00"))), 2500)).isEmpty();
        assertThat(GroupPaceService.segmentRatios(plan(List.of(seg(1, 0, 1000, "1.10"),
                seg(2, 1000, 2000, "1.10"), seg(3, 2000, 2500, "1.10"))), 2500)).isEmpty();
        var offPace = new PersonalPacePlanPort.Segment(1, BigDecimal.ZERO, BigDecimal.valueOf(1000),
                BigDecimal.valueOf(430), BigDecimal.ONE);
        assertThat(GroupPaceService.segmentRatios(plan(List.of(offPace, seg(2, 1000, 2000, "1.00"),
                seg(3, 2000, 2500, "1.00"))), 2500)).isEmpty();
    }

    private static List<GroupPaceRepository.SegmentRatio> uniformStartSegments() {
        return java.util.stream.IntStream.range(0, 5)
                .mapToObj(i -> new GroupPaceRepository.SegmentRatio(BigDecimal.valueOf(i * 1000L),
                        BigDecimal.valueOf((i + 1) * 1000L), BigDecimal.ONE))
                .toList();
    }

    @Test
    void startBackfillTargets_enabledReadsTheRepository() {
        var fixture = new RunningFixture();
        when(fixture.states.findStartBackfillTargets(5)).thenReturn(List.of(7L));
        assertThat(fixture.service.startBackfillTargets(5)).containsExactly(7L);
    }

    private static class RunningFixture {
        final GroupPaceRepository states = mock(GroupPaceRepository.class);
        final GroupRunJdbcRepository groups = mock(GroupRunJdbcRepository.class);
        final GroupRunParticipantJdbcRepository participants = mock(GroupRunParticipantJdbcRepository.class);
        final SessionCoachingRepository coaching = mock(SessionCoachingRepository.class);
        final SessionReferenceRepository references = mock(SessionReferenceRepository.class);
        final GroupPacePort ai = mock(GroupPacePort.class);
        final PersonalPacePlanPort plans = mock(PersonalPacePlanPort.class);
        final com.runway.backend.domain.grouprun.repository.GroupRunFitJdbcRepository fits = mock(com.runway.backend.domain.grouprun.repository.GroupRunFitJdbcRepository.class);
        final Instant token = Instant.parse("2026-01-01T00:00:00Z");
        final SegmentDifficultyProvider difficulty = mock(SegmentDifficultyProvider.class);
        final GroupPaceService service;

        RunningFixture() {
            this(0, "");
        }

        RunningFixture(int demoStartPace, String demoUserIds) {
            var manager = mock(PlatformTransactionManager.class);
            when(manager.getTransaction(any())).thenReturn(mock(org.springframework.transaction.TransactionStatus.class));
            service = new GroupPaceService(true, demoStartPace, demoUserIds, states, groups, participants, coaching, references,
                    ai, plans, mock(ApplicationEventPublisher.class),
                    JsonMapper.builder().build(), manager, fits, difficulty);
            when(groups.findById(7)).thenReturn(Optional.of(new GroupRunRow(7, 1, 9, null,
                    "test", null, token, null, null, null, 5000, 1800, "RUNNING", null, token, token)));
            when(states.find(7)).thenReturn(Optional.of(new GroupPaceRepository.State(375, 380,
                    "SLOW", token, 1, token)));
            when(states.reserve(7, token)).thenReturn(Optional.of(token));
            when(states.runners(7)).thenReturn(List.of(new GroupPaceRepository.Runner(9, 8,
                    "RUNNING", Instant.now().minusSeconds(600), true)));
            Instant sampledAt = Instant.now();
            when(references.findGroupLiveRows(eq(7L), any())).thenReturn(List.of(
                    new SessionReferenceRepository.GroupLiveRow(9, "RUNNING", token,
                            BigDecimal.valueOf(1000), sampledAt, BigDecimal.valueOf(360),
                            sampledAt)));
            when(coaching.recentSamples(8, 1800, true)).thenReturn(List.of(
                    new com.runway.backend.domain.coaching.decide.CoachingSource.Sample(600,
                            Instant.now(), 150.0, 2.8, null, 1000.0, null)));
            when(states.consented(9)).thenReturn(true);
        }

        void scheduled() {
            when(groups.findById(7)).thenReturn(Optional.of(new GroupRunRow(7, 1, 9, null,
                    "test", null, token, null, null, null, 5000, 1800, "SCHEDULED", null, token, token)));
        }

        void goal(Long courseId, Integer distance) {
            when(groups.findById(7)).thenReturn(Optional.of(new GroupRunRow(7, 1, 9, courseId,
                    "test", null, token, null, null, null, distance, 1800, "RUNNING", null, token, token)));
        }

        GroupPacePort.Request request() {
            service.evaluateRunning(7);
            var capture = org.mockito.ArgumentCaptor.forClass(GroupPacePort.Request.class);
            verify(ai).evaluate(capture.capture());
            return capture.getValue();
        }
    }
}
