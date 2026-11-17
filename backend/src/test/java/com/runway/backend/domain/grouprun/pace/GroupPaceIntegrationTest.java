package com.runway.backend.domain.grouprun.pace;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import com.runway.backend.domain.grouprun.service.GroupRunService;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;
import com.runway.backend.support.SharedContextIntegrationSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.CyclicBarrier;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "runway.group-pace.enabled=true")
class GroupPaceIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired JdbcTemplate jdbc;
    @Autowired GroupPaceService pace;
    @Autowired GroupPaceRepository states;
    @Autowired GroupRunService groups;
    @Autowired GroupPaceTrigger trigger;
    @MockitoBean GroupPacePort ai;
    @MockitoBean PersonalPacePlanPort plans;
    long host;
    long crew;
    long group;

    @BeforeEach
    void seed() {
        host = user(1, true);
        crew = jdbc.queryForObject("INSERT INTO crews(owner_id,name,capacity,status) VALUES (?, 'pace', 20, 'ACTIVE') RETURNING id", Long.class, host);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())", crew, host);
        group = jdbc.queryForObject("""
                INSERT INTO group_runs(crew_id,host_id,title,scheduled_at,goal_distance,goal_duration,status)
                VALUES (?,?,'pace',now(),5000,1800,'RUNNING') RETURNING id
                """, Long.class, crew, host);
        runner(host, "RUNNING", 0);
        when(ai.evaluate(any())).thenReturn(Optional.empty());
    }

    @Test
    void success_storesAndLiveReadsWithoutCallingAgain() {
        when(ai.evaluate(any())).thenReturn(Optional.of(result(375, true, 2)));
        pace.evaluateRunning(group);
        var state = states.find(group).orElseThrow();
        assertThat(state.pace()).isEqualTo(375);
        assertThat(state.direction()).isEqualTo("SLOW");
        assertThat(state.changedAt()).isNotNull();
        var live = groups.getLive(host, group);
        assertThat(live.groupGuidePaceSecPerKm()).isEqualTo(375);
        assertThat(live.loadAlert().memberCount()).isEqualTo(2);
        assertThat(live.loadAlert().nextPaceSecPerKm()).isEqualTo(375);
        groups.getLive(host, group);
        verify(ai, times(1)).evaluate(any());
        assertThat(states.find(group).orElseThrow().updatedAt()).isEqualTo(state.updatedAt());
    }

    @Test
    void failedAi_keepsPreviousAndFirstFailureFallsBackToMedian() {
        pace.evaluateRunning(group);
        assertThat(states.find(group).orElseThrow().pace()).isNull();
        // S15P31E105-598: 폴백 중앙값은 최근 60초 실측 속도(2.8 m/s → 357 sec/km)를 쓴다.
        assertThat(groups.getLive(host, group).groupGuidePaceSecPerKm()).isEqualTo(357);
        jdbc.update("DELETE FROM group_run_pace_state WHERE group_run_id=?", group);
        jdbc.update("""
                INSERT INTO group_run_pace_state(group_run_id,group_pace_sec_per_km,struggling_count,updated_at)
                VALUES (?,390,1,now()-interval '31 seconds')
                """, group);
        pace.evaluateRunning(group);
        assertThat(states.find(group).orElseThrow().pace()).isEqualTo(390);
        assertThat(groups.getLive(host, group).loadAlert().nextPaceSecPerKm()).isEqualTo(390);
    }

    @Test
    void throttle_preventsCallsOnRepeatedParticipantBatches() {
        for (int i = 0; i < 4; i++) pace.evaluateRunning(group);
        verify(ai, times(1)).evaluate(any());
    }

    @Test
    void concurrentReservations_onlyOneWinsAndRecentAttemptCannotReserveAgain() throws Exception {
        states.invalidateStart(group);
        jdbc.update("DELETE FROM group_run_pace_state WHERE group_run_id=?", group);
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> { barrier.await(); return states.reserve(group, null); });
            var b = pool.submit(() -> { barrier.await(); return states.reserve(group, null); });
            assertThat(List.of(a.get().isPresent(), b.get().isPresent())).containsExactlyInAnyOrder(true, false);
        }
        assertThat(states.reserve(group, states.find(group).orElseThrow().updatedAt())).isEmpty();
    }

    @Test
    void running_beforeFirstDecision_togetherStartsAtStoredAiRecommendation() {
        // S15P31E105-750: the start calculation stored 343 (AI 추천); the goal pace is 360 and the measured median 357.
        startState(343, "TOGETHER");
        pace.evaluateRunning(group);
        var capture = ArgumentCaptor.forClass(GroupPacePort.Request.class);
        verify(ai).evaluate(capture.capture());
        assertThat(capture.getValue().currentGroupPaceSecPerKm()).isEqualTo(343);
        assertThat(capture.getValue().startRecommendedPaceSecPerKm()).isEqualTo(343);
        assertThat(groups.getLive(host, group).groupGuidePaceSecPerKm()).isEqualTo(343);
        assertThat(groups.getDetail(host, group).groupGuidePaceSecPerKm()).isEqualTo(343);
        // Once AI10 has decided, its pace wins over the start recommendation.
        jdbc.update("UPDATE group_run_pace_state SET group_pace_sec_per_km=375 WHERE group_run_id=?", group);
        assertThat(groups.getLive(host, group).groupGuidePaceSecPerKm()).isEqualTo(375);
    }

    @Test
    void running_beforeFirstDecision_goalStartsAtGoalAndNoStartPaceFallsBackToMedian() {
        startState(343, "GOAL");
        pace.evaluateRunning(group);
        var capture = ArgumentCaptor.forClass(GroupPacePort.Request.class);
        verify(ai).evaluate(capture.capture());
        assertThat(capture.getValue().currentGroupPaceSecPerKm()).isEqualTo(360);
        assertThat(groups.getLive(host, group).groupGuidePaceSecPerKm()).isEqualTo(360);

        jdbc.update("DELETE FROM group_run_pace_state WHERE group_run_id=?", group);
        startState(null, "TOGETHER");
        pace.evaluateRunning(group);
        verify(ai, times(2)).evaluate(capture.capture());
        assertThat(capture.getValue().currentGroupPaceSecPerKm()).isEqualTo(357);
        assertThat(groups.getLive(host, group).groupGuidePaceSecPerKm()).isEqualTo(357);
    }

    private void startState(Integer startPace, String mode) {
        jdbc.update("""
                INSERT INTO group_run_pace_state(group_run_id,start_recommended_pace_sec_per_km,pace_mode,
                    struggling_count,updated_at)
                VALUES (?,?,?,0,now()-interval '31 seconds')
                """, group, startPace, mode);
    }

    @Test
    void input_marksPausedEndedStaleInactiveAndStripsNonConsentIdentityAndHr() {
        runner(user(2, true), "PAUSED", 0);
        runner(user(3, true), "COMPLETED", 0);
        runner(user(4, true), "RUNNING", 90);
        long anonymous = user(5, false);
        runner(anonymous, "RUNNING", 0);
        pace.evaluateRunning(group);
        var capture = ArgumentCaptor.forClass(GroupPacePort.Request.class);
        verify(ai).evaluate(capture.capture());
        var request = capture.getValue();
        assertThat(request.participants()).extracting(GroupPacePort.Participant::active)
                .containsExactly(true, false, false, false, true);
        var last = request.participants().getLast();
        assertThat(last.userId()).isNull();
        assertThat(last.history().hrBpm()).containsOnlyNulls();
        assertThat(last.history().speedMps()).contains(2.8);
        assertThat(request.participants().getFirst().history().hrBpm()).contains(150.0);
        assertThat(request.participants()).allMatch(p -> p.futureGradePct() == null);
    }

    @Test
    void preRun_usesRiegelDistanceSelectsThreeSlowestAndNoRecordAndStoresMaxGoal() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        // host is no-record; other candidates have valid completed records.
        var candidates = new ArrayList<Long>();
        for (int i = 2; i <= 6; i++) {
            long id = user(i, true);
            candidates.add(id);
            jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)", group, id);
            jdbc.update("""
                    INSERT INTO running_sessions(user_id,status,started_at,ended_at,average_pace,total_distance,moving_duration)
                    VALUES (?,'COMPLETED',now()-interval '1 hour',now(),?,?,?)
                    """, id, i == 2 ? 390 : 300 + i * 10, i == 2 ? 50000 : 1000, i == 2 ? 19500 : 600);
        }
        states.invalidateStart(group);
        when(plans.plan(any(), any())).thenAnswer(invocation -> Optional.of(
                new PersonalPacePlanPort.Result(null, invocation.getArgument(0),
                        BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));
        pace.evaluateStart(group);
        var selected = ArgumentCaptor.forClass(Long.class);
        var goals = ArgumentCaptor.forClass(com.runway.backend.domain.session.entity.SessionGoal.class);
        verify(plans, times(4)).plan(selected.capture(), goals.capture());
        assertThat(selected.getAllValues()).containsExactlyInAnyOrder(host, candidates.get(2),
                candidates.get(3), candidates.get(4));
        assertThat(goals.getAllValues()).allMatch(g -> g.distanceM() == 5000
                && g.courseId() == null && g.durationSec() == null && g.paceSecPerKm() == null);
        assertThat(states.find(group).orElseThrow().startPace()).isEqualTo(410);
        assertThat(groups.getDetail(host, group).groupGuidePaceSecPerKm()).isEqualTo(410);
    }

    @Test
    void preRun_shortOrWalkRecordsOnly_countAsNoRecordAndGoToAi09ColdStart() {
        // S15P31E105-886: 1 km 미만·이동 10분 미만 기록만 있는 참가자는 '기록 없음'이라 AI09(userId → 가입 기준 콜드 스타트)에 항상 보낸다.
        // 예전에는 짧은 빠른 기록(200초/km, 500 m)이 '기록 있음'으로 잡혀 느린 3명 밖으로 밀렸다.
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        jdbc.update("""
                INSERT INTO running_sessions(user_id,status,started_at,ended_at,average_pace,total_distance,moving_duration)
                VALUES (?,'COMPLETED',now()-interval '1 hour',now(),300,5000,1500)
                """, host);
        var candidates = new ArrayList<Long>();
        for (int i = 2; i <= 5; i++) {
            long id = user(i, true);
            candidates.add(id);
            jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)", group, id);
            boolean shortOnly = i == 2;
            jdbc.update("""
                    INSERT INTO running_sessions(user_id,status,started_at,ended_at,average_pace,total_distance,moving_duration)
                    VALUES (?,'COMPLETED',now()-interval '1 hour',now(),?,?,?)
                    """, id, shortOnly ? 200 : 300 + i * 10, shortOnly ? 500 : 5000, shortOnly ? 100 : 1800);
        }
        states.invalidateStart(group);
        when(plans.plan(any(), any())).thenAnswer(invocation -> Optional.of(
                new PersonalPacePlanPort.Result(null, invocation.getArgument(0),
                        BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));
        pace.evaluateStart(group);
        var selected = ArgumentCaptor.forClass(Long.class);
        verify(plans, times(4)).plan(selected.capture(), any());
        assertThat(selected.getAllValues()).containsExactlyInAnyOrder(candidates.get(0),
                candidates.get(1), candidates.get(2), candidates.get(3));
    }

    @Test
    void preRun_goalChangeDuringAi_discardsOldResult() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        states.invalidateStart(group);
        when(plans.plan(any(), any())).thenAnswer(invocation -> {
            jdbc.update("UPDATE group_runs SET goal_distance=10000 WHERE id=?", group);
            states.invalidateStart(group);
            return Optional.of(new PersonalPacePlanPort.Result(null, host,
                    BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of()));
        });
        pace.evaluateStart(group);
        assertThat(states.find(group).orElseThrow().startPace()).isNull();
    }

    @Test
    void committedJoinLeaveAndGoalPatch_triggerBackgroundRecalculation() throws Exception {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        long member = user(2, true);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())", crew, member);
        var calculated = new java.util.concurrent.Semaphore(0);
        when(plans.plan(any(), any())).thenAnswer(invocation -> {
            calculated.release();
            return Optional.empty();
        });
        groups.join(member, group);
        assertThat(calculated.tryAcquire(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        groups.leave(member, group);
        assertThat(calculated.tryAcquire(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        var patch = new com.runway.backend.domain.grouprun.dto.request.PatchGroupRunRequest();
        patch.setTargetDistanceM(10000);
        patch.setGoalInputType("TIME");
        patch.setTargetDurationSec(3600);
        groups.patch(host, group, patch);
        assertThat(calculated.tryAcquire(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        verify(plans).plan(eq(host), argThat(goal -> goal.distanceM() == 10000));
    }

    /** 5 km plan of a 410 s/km mean with km ratios 1.05, 1.02, 1.00, 0.98, 0.95 (S15P31E105-739). */
    private static PersonalPacePlanPort.Result kmPlan(Long user) {
        BigDecimal[] ratios = {new BigDecimal("1.05"), new BigDecimal("1.02"), BigDecimal.ONE,
                new BigDecimal("0.98"), new BigDecimal("0.95")};
        List<PersonalPacePlanPort.Segment> segments = new ArrayList<>();
        for (int i = 0; i < ratios.length; i++) {
            segments.add(new PersonalPacePlanPort.Segment(i + 1, BigDecimal.valueOf(i * 1000L),
                    BigDecimal.valueOf((i + 1) * 1000L),
                    BigDecimal.valueOf(410).multiply(ratios[i]), ratios[i]));
        }
        return new PersonalPacePlanPort.Result(null, user, BigDecimal.valueOf(5000),
                BigDecimal.valueOf(410), segments);
    }

    @Test
    void detail_kmSegmentsFollowTheAiPlanInTogetherAndTheGoalInGoalMode() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        when(plans.plan(any(), any())).thenAnswer(invocation -> Optional.of(kmPlan(invocation.getArgument(0))));
        states.invalidateStart(group);
        pace.evaluateStart(group);
        var together = groups.getDetail(host, group).paceSegments();
        assertThat(together).extracting(s -> s.recommendedPaceSecPerKm().doubleValue())
                .containsExactly(430.5, 418.2, 410.0, 401.8, 389.5);
        assertThat(together.getLast().endDistanceM()).isEqualByComparingTo("5000");

        // GOAL (5000 m / 1800 s = 360 s/km): the goal with the same AI ratios.
        states.saveMode(group, "GOAL");
        states.invalidateStart(group);
        assertThat(groups.getDetail(host, group).paceSegments()).isEmpty();   // recalculating: none
        pace.evaluateStart(group);
        assertThat(groups.getDetail(host, group).paceSegments())
                .extracting(s -> s.recommendedPaceSecPerKm().doubleValue())
                .containsExactly(378.0, 367.2, 360.0, 352.8, 342.0);
    }

    @Test
    void detail_kmSegmentsComeFromTheSlowestMembersPlanOnly_andHideAfterConsentWithdrawalOrStart() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        long member = user(2, true);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())", crew, member);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)", group, member);
        // The host plans 410 with a falling profile; the member plans 380 flat. The host is the slowest basis.
        when(plans.plan(any(), any())).thenAnswer(invocation -> {
            long user = invocation.getArgument(0);
            if (user == host) return Optional.of(kmPlan(user));
            List<PersonalPacePlanPort.Segment> flat = new ArrayList<>();
            for (int i = 0; i < 5; i++) {
                flat.add(new PersonalPacePlanPort.Segment(i + 1, BigDecimal.valueOf(i * 1000L),
                        BigDecimal.valueOf((i + 1) * 1000L), BigDecimal.valueOf(380), BigDecimal.ONE));
            }
            return Optional.of(new PersonalPacePlanPort.Result(null, user, BigDecimal.valueOf(5000),
                    BigDecimal.valueOf(380), flat));
        });
        states.invalidateStart(group);
        pace.evaluateStart(group);
        assertThat(groups.getDetail(host, group).paceSegments())
                .extracting(s -> s.recommendedPaceSecPerKm().doubleValue())
                .containsExactly(430.5, 418.2, 410.0, 401.8, 389.5);

        jdbc.update("UPDATE users SET health_data_access='DISAGREE'::users_health_data_access_enum WHERE id=?", host);
        assertThat(groups.getDetail(member, group).paceSegments()).isEmpty();
        jdbc.update("UPDATE users SET health_data_access='AGREE'::users_health_data_access_enum WHERE id=?", host);

        jdbc.update("UPDATE group_runs SET status='RUNNING' WHERE id=?", group);
        assertThat(groups.getDetail(host, group).paceSegments()).isEmpty();
    }

    // ---- S15P31E105-817: 기동 시 km 비율 재계산 ----

    private long scheduledGroupWithStartPaceButNoRatios(String status, Integer goalDistance) {
        long id = jdbc.queryForObject("""
                INSERT INTO group_runs(crew_id,host_id,title,scheduled_at,goal_distance,goal_duration,status)
                VALUES (?,?,'old',now(),?,1800,?::group_runs_status_enum) RETURNING id
                """, Long.class, crew, host, goalDistance, status);
        jdbc.update("""
                INSERT INTO group_run_pace_state(group_run_id, start_recommended_pace_sec_per_km,
                    ai_recommended_pace_sec_per_km, pace_basis_user_id) VALUES (?, 410, 410, ?)
                """, id, host);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)", id, host);
        return id;
    }

    /** kmPlan과 같은 모양이고 평균만 pace(s/km)로 바꾼 5 km 계획. */
    private static PersonalPacePlanPort.Result kmPlanAt(Long user, int pace) {
        BigDecimal[] ratios = {new BigDecimal("1.05"), new BigDecimal("1.02"), BigDecimal.ONE,
                new BigDecimal("0.98"), new BigDecimal("0.95")};
        List<PersonalPacePlanPort.Segment> segments = new ArrayList<>();
        for (int i = 0; i < ratios.length; i++) {
            segments.add(new PersonalPacePlanPort.Segment(i + 1, BigDecimal.valueOf(i * 1000L),
                    BigDecimal.valueOf((i + 1) * 1000L),
                    BigDecimal.valueOf(pace).multiply(ratios[i]), ratios[i]));
        }
        return new PersonalPacePlanPort.Result(null, user, BigDecimal.valueOf(5000),
                BigDecimal.valueOf(pace), segments);
    }

    @Test
    void backfill_targetsOnlyScheduledRecentGroupsWithStartPaceAndDistanceButNoRatios() {
        long target = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        scheduledGroupWithStartPaceButNoRatios("RUNNING", 5000);
        scheduledGroupWithStartPaceButNoRatios("SCHEDULED", null);
        long filled = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_run_pace_state SET start_segment_ratios='[{\"startDistanceM\":0,\"endDistanceM\":5000,\"ratio\":1}]'::jsonb"
                + " WHERE group_run_id=?", filled);
        long noPace = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_run_pace_state SET start_recommended_pace_sec_per_km=NULL WHERE group_run_id=?", noPace);
        // 예정 시각이 하루 넘게 지난 채 방치된 방은 제외한다.
        long stale = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_runs SET scheduled_at = now() - interval '2 days' WHERE id=?", stale);
        assertThat(pace.startBackfillTargets(100)).containsExactly(target);
    }

    @Test
    void backfill_limitKeepsUpcomingGroupsClosestToNowFirstAndPastOnesLast() {
        long far = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_runs SET scheduled_at = now() + interval '3 days' WHERE id=?", far);
        long near = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_runs SET scheduled_at = now() + interval '1 hour' WHERE id=?", near);
        long mid = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_runs SET scheduled_at = now() + interval '1 day' WHERE id=?", mid);
        // 방금 지난 방(최대 1일 전)은 곧 열릴 미래 방보다 가까워 보여도 뒤로 가서 상한 밖으로 밀어내지 못한다.
        long past = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        jdbc.update("UPDATE group_runs SET scheduled_at = now() - interval '1 minute' WHERE id=?", past);
        assertThat(pace.startBackfillTargets(2)).containsExactly(near, mid);
        assertThat(pace.startBackfillTargets(3)).containsExactly(near, mid, far);
        assertThat(pace.startBackfillTargets(100)).containsExactly(near, mid, far, past);
    }

    @Test
    void backfill_recalculatesWithLatestPlanAndFillsRatios_theOldPaceStaysUntilTheNewOneIsSaved() {
        long target = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        assertThat(groups.getDetail(host, target).paceSegments()).isEmpty();
        List<Integer> seenDuringCall = new ArrayList<>();
        List<Boolean> calculatingDuringCall = new ArrayList<>();
        when(plans.plan(any(), any())).thenAnswer(i -> {
            var state = states.find(target).orElseThrow();
            seenDuringCall.add(state.startPace());
            calculatingDuringCall.add(state.calculating());
            return Optional.of(kmPlanAt(i.getArgument(0), 420));
        });
        var result = trigger.backfillStart();
        // AI 호출 중에는 이전 출발 페이스가 그대로 있고 '계산 중'도 아니다.
        assertThat(seenDuringCall).containsExactly(410);
        assertThat(calculatingDuringCall).containsExactly(false);
        assertThat(result).isEqualTo(new GroupPaceTrigger.BackfillResult(1, 1, 0, 0, 0, 0));
        assertThat(pace.startBackfillTargets(100)).isEmpty();
        // 같은 계산이라 최신 AI 결과(420)로 다시 저장되고 비율이 채워진다.
        var detail = groups.getDetail(host, target);
        assertThat(detail.groupGuidePaceSecPerKm()).isEqualTo(420);
        assertThat(detail.paceSegments()).hasSize(5);
        // 다시 돌려도 대상이 없어 AI를 더 부르지 않는다.
        clearInvocations(plans);
        trigger.backfillStart();
        verifyNoInteractions(plans);
    }

    @Test
    void backfill_aiFailureKeepsThePaceEndsNotCalculatingAndStaysATarget() {
        long target = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        when(plans.plan(any(), any())).thenReturn(Optional.empty());
        var result = trigger.backfillStart();
        assertThat(result).isEqualTo(new GroupPaceTrigger.BackfillResult(1, 0, 0, 1, 0, 1));
        assertThat(jdbc.queryForObject("SELECT start_recommended_pace_sec_per_km FROM group_run_pace_state"
                + " WHERE group_run_id=?", Integer.class, target)).isEqualTo(410);
        assertThat(jdbc.queryForObject("SELECT start_requested_at FROM group_run_pace_state"
                + " WHERE group_run_id=?", Timestamp.class, target)).isNull();
        var detail = groups.getDetail(host, target);
        assertThat(detail.paceCalculating()).isFalse();
        assertThat(detail.groupGuidePaceSecPerKm()).isEqualTo(410);
        assertThat(pace.startBackfillTargets(100)).containsExactly(target);
    }

    @Test
    void backfill_changeDuringTheRecalculationDiscardsTheOldResult() {
        long target = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        when(plans.plan(any(), any())).thenAnswer(i -> {
            // 계산 중에 목표가 바뀐 것처럼 상태 토큰을 바꾼다.
            jdbc.update("UPDATE group_run_pace_state SET struggling_count = struggling_count WHERE group_run_id=?", target);
            return Optional.of(kmPlanAt(i.getArgument(0), 420));
        });
        assertThat(pace.evaluateStart(target)).isFalse();
        assertThat(pace.startBackfillTargets(100)).contains(target);
    }

    @Test
    void backfill_missingAiRatiosSavesFallbackAndRemovesTarget() {
        long target = scheduledGroupWithStartPaceButNoRatios("SCHEDULED", 5000);
        when(plans.plan(any(), any())).thenAnswer(i -> Optional.of(new PersonalPacePlanPort.Result(
                null, i.getArgument(0), BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));
        var result = trigger.backfillStart();
        assertThat(result).isEqualTo(new GroupPaceTrigger.BackfillResult(1, 1, 0, 0, 0, 0));
        assertThat(pace.startBackfillTargets(100)).isEmpty();
        assertThat(groups.getDetail(host, target).groupGuidePaceSecPerKm()).isEqualTo(410);
        assertThat(groups.getDetail(host, target).paceSegments()).hasSize(5);
    }

    @Test
    void detail_planWithoutUsableSegments_returnsUniformKmPaces() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        when(plans.plan(any(), any())).thenAnswer(invocation -> Optional.of(
                new PersonalPacePlanPort.Result(null, invocation.getArgument(0),
                        BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));
        states.invalidateStart(group);
        pace.evaluateStart(group);
        var detail = groups.getDetail(host, group);
        assertThat(detail.groupGuidePaceSecPerKm()).isEqualTo(410);
        assertThat(detail.paceSegments()).hasSize(5).allSatisfy(segment ->
                assertThat(segment.recommendedPaceSecPerKm()).isEqualByComparingTo("410"));
    }

    @Test
    void detail_showsCalculatingThenMemberBasisAiRecommendationAndSlowerCount() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        states.invalidateStart(group);
        var calculating = groups.getDetail(host, group);
        assertThat(calculating.paceCalculating()).isTrue();
        assertThat(calculating.paceBasis().type()).isEqualTo("MEDIAN");
        assertThat(calculating.groupPaceMode()).isEqualTo("TOGETHER");
        assertThat(calculating.aiRecommendedPaceSecPerKm()).isNull();
        when(plans.plan(any(), any())).thenAnswer(invocation -> Optional.of(
                new PersonalPacePlanPort.Result(null, invocation.getArgument(0),
                        BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));
        pace.evaluateStart(group);
        var done = groups.getDetail(host, group);
        assertThat(done.paceCalculating()).isFalse();
        assertThat(done.aiRecommendedPaceSecPerKm()).isEqualTo(410);
        assertThat(done.goalPaceSecPerKm()).isEqualTo(360);
        assertThat(done.groupGuidePaceSecPerKm()).isEqualTo(410);
        assertThat(done.paceBasis()).isEqualTo(
                new com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse.PaceBasis(
                        "MEMBER", "pace1"));
        assertThat(done.slowerThanGoalCount()).isEqualTo(1);
    }

    @Test
    void detail_staleOrAbandonedRequestIsNotCalculating() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        states.invalidateStart(group);
        jdbc.update("UPDATE group_run_pace_state SET start_requested_at=now()-interval '121 seconds' WHERE group_run_id=?", group);
        assertThat(groups.getDetail(host, group).paceCalculating()).isFalse();
        states.invalidateStart(group);
        pace.evaluateStart(group); // plans returns empty by default: the calculation gives up
        assertThat(groups.getDetail(host, group).paceCalculating()).isFalse();
        assertThat(states.find(group).orElseThrow().startRequestedAt()).isNull();
    }

    @Test
    void detail_goalModeUsesGoalWithoutResultAndTurnsTogetherWhenGoalIsRemoved() {
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        states.saveMode(group, "GOAL");
        states.invalidateStart(group);
        pace.evaluateStart(group); // plans returns empty by default: the calculation gives up
        var detail = groups.getDetail(host, group);
        assertThat(detail.groupGuidePaceSecPerKm()).isEqualTo(360);
        assertThat(detail.paceBasis().type()).isEqualTo("GOAL");
        assertThat(detail.groupPaceMode()).isEqualTo("GOAL");
        jdbc.update("UPDATE group_runs SET goal_duration=NULL WHERE id=?", group);
        var noGoal = groups.getDetail(host, group);
        assertThat(noGoal.groupPaceMode()).isEqualTo("TOGETHER");
        assertThat(noGoal.paceBasis().type()).isEqualTo("MEDIAN");
    }

    @Test
    void paceMode_hostOnlyBeforeStartGoalNeedsGoalPaceAndRecalculatesToGoal() throws Exception {
        long member = user(2, true);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())", crew, member);
        var goalMode = new com.runway.backend.domain.grouprun.dto.request.GroupPaceModeRequest("GOAL");
        assertThat(code(() -> groups.changePaceMode(host, group, goalMode))).isEqualTo("EDIT_NOT_ALLOWED");
        jdbc.update("UPDATE group_runs SET status='SCHEDULED' WHERE id=?", group);
        assertThat(code(() -> groups.changePaceMode(member, group, goalMode))).isEqualTo("NOT_HOST");
        assertThat(code(() -> groups.changePaceMode(host, group,
                new com.runway.backend.domain.grouprun.dto.request.GroupPaceModeRequest("FAST"))))
                .isEqualTo("VALIDATION_ERROR");
        jdbc.update("UPDATE group_runs SET goal_duration=NULL WHERE id=?", group);
        assertThat(code(() -> groups.changePaceMode(host, group, goalMode))).isEqualTo("VALIDATION_ERROR");
        jdbc.update("UPDATE group_runs SET goal_duration=1800 WHERE id=?", group);

        when(plans.plan(any(), any())).thenAnswer(invocation -> Optional.of(
                new PersonalPacePlanPort.Result(null, invocation.getArgument(0),
                        BigDecimal.valueOf(5000), BigDecimal.valueOf(410), List.of())));
        var response = groups.changePaceMode(host, group, goalMode);
        assertThat(response.paceMode()).isEqualTo("GOAL");
        long deadline = System.currentTimeMillis() + 5000;
        while (states.find(group).orElseThrow().startPace() == null && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }
        var detail = groups.getDetail(host, group);
        assertThat(detail.groupPaceMode()).isEqualTo("GOAL");
        assertThat(detail.groupGuidePaceSecPerKm()).isEqualTo(360);
        assertThat(detail.aiRecommendedPaceSecPerKm()).isEqualTo(410);
        assertThat(detail.paceBasis().type()).isEqualTo("GOAL");
        assertThat(detail.paceBasis().nickname()).isEqualTo("pace1");
        assertThat(detail.slowerThanGoalCount()).isEqualTo(1);
    }

    private static String code(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        var thrown = catchThrowable(call);
        assertThat(thrown).isInstanceOf(com.runway.backend.global.exception.ApiException.class);
        return ((com.runway.backend.global.exception.ApiException) thrown).code();
    }

    @Test
    void v33_paceModeDefaultsAndRejectsUnknownMode() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version='33' AND success", Integer.class)).isEqualTo(1);
        states.invalidateStart(group);
        assertThat(states.find(group).orElseThrow().mode()).isEqualTo("TOGETHER");
        assertThatThrownBy(() -> jdbc.update("UPDATE group_run_pace_state SET pace_mode='FAST' WHERE group_run_id=?", group))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }

    @Test
    void v22_identityUniqueForeignKeyCascadeAndUpdatedAtTriggerApply() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version='22' AND success", Integer.class)).isEqualTo(1);
        states.invalidateStart(group);
        var previous = states.find(group).orElseThrow().updatedAt();
        states.invalidateStart(group);
        assertThat(states.find(group).orElseThrow().updatedAt()).isAfter(previous);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO group_run_pace_state(group_run_id) VALUES (?)", group))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO group_run_pace_state(group_run_id) VALUES (-1)"))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        jdbc.update("DELETE FROM group_run_participants WHERE group_run_id=?", group);
        jdbc.update("DELETE FROM group_runs WHERE id=?", group);
        assertThat(states.find(group)).isEmpty();
    }

    private GroupPacePort.Result result(int pace, boolean changed, int struggling) {
        return new GroupPacePort.Result(pace, changed, changed ? "SLOW" : "HOLD", "HR_LIMIT",
                struggling, 0, 0, List.of(), "test");
    }

    private long user(int n, boolean consent) {
        return jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?,'synthetic',?,'2000-01-01','MALE',?,?::users_health_data_access_enum) RETURNING id
                """, Long.class, "pace"+n, "pace"+n, "0101111000"+n, consent ? "AGREE" : "DISAGREE");
    }

    private long runner(long user, String status, int ageSeconds) {
        long session = jdbc.queryForObject("""
                INSERT INTO running_sessions(user_id,status,started_at,average_pace)
                VALUES (?,?::running_sessions_status_enum,now()-interval '10 minutes',360) RETURNING id
                """, Long.class, user, status);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id,session_id) VALUES (?,?,?)", group, user, session);
        jdbc.update("""
                INSERT INTO running_metric_samples(running_session_id,measured_at,elapsed_duration,
                    heart_rate,speed,total_distance,is_hr_measured) VALUES (?,?,600,150,2.8,1000,true)
                """, session, Timestamp.from(Instant.now().minusSeconds(ageSeconds)));
        return session;
    }
}
