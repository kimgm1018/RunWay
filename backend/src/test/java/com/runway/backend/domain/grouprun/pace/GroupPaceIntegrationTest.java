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
                    INSERT INTO running_sessions(user_id,status,started_at,ended_at,average_pace,total_distance)
                    VALUES (?,'COMPLETED',now()-interval '1 hour',now(),?,?)
                    """, id, i == 2 ? 390 : 300 + i * 10, i == 2 ? 50000 : 1000);
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
                """, Long.class, "pace"+n, "pace"+n, "0101111000"+n, consent ? "AGREEE" : "DISAGREE");
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
