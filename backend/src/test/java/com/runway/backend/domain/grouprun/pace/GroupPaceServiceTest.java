package com.runway.backend.domain.grouprun.pace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.runway.backend.domain.grouprun.repository.*;
import com.runway.backend.domain.session.repository.*;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;
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
        var service = new GroupPaceService(false, states, groups, participants, coaching, references,
                ai, plans, events, JsonMapper.builder().build(), transactions);
        service.membershipOrGoalChanged(7);
        service.onBatch(8);
        service.evaluateRunning(7);
        service.evaluateStart(7);
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
                new GroupPaceRepository.Start(410, 410, 13, 4));
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
                new GroupPaceRepository.Start(expected, plannedPace, 10, slower));
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
                new GroupPaceRepository.Start(360, 420, 9, 2));
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

    private static class RunningFixture {
        final GroupPaceRepository states = mock(GroupPaceRepository.class);
        final GroupRunJdbcRepository groups = mock(GroupRunJdbcRepository.class);
        final GroupRunParticipantJdbcRepository participants = mock(GroupRunParticipantJdbcRepository.class);
        final SessionCoachingRepository coaching = mock(SessionCoachingRepository.class);
        final SessionReferenceRepository references = mock(SessionReferenceRepository.class);
        final GroupPacePort ai = mock(GroupPacePort.class);
        final PersonalPacePlanPort plans = mock(PersonalPacePlanPort.class);
        final Instant token = Instant.parse("2026-01-01T00:00:00Z");
        final GroupPaceService service;

        RunningFixture() {
            var manager = mock(PlatformTransactionManager.class);
            when(manager.getTransaction(any())).thenReturn(mock(org.springframework.transaction.TransactionStatus.class));
            service = new GroupPaceService(true, states, groups, participants, coaching, references,
                    ai, plans, mock(ApplicationEventPublisher.class),
                    JsonMapper.builder().build(), manager);
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
