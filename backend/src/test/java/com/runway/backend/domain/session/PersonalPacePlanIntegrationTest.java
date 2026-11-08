package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.session.service.PersonalPacePlanPort.*;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;

class PersonalPacePlanIntegrationTest extends RunningSessionIntegrationSupport {
    @org.springframework.beans.factory.annotation.Autowired
    private com.runway.backend.domain.device.service.ConsentService consentService;

    @Test
    void distanceOnlyStoresAndRoundTripsPlan() throws Exception {
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":2500}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.segments.length()").value(3))
                .andExpect(jsonPath("$.plan.segments[2].endDistanceM").value(2500));
        assertThat(personalPlan.calls.get()).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plan_segments")).isEqualTo(3);
    }

    @Test
    void unavailablePlanRollsBackAndLeavesCourse() throws Exception {
        long course = insertCourse("ACTIVE", "3000");
        personalPlan.answer = (u, g) -> Optional.empty();
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"courseId\":" + course + "}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(count("SELECT count(*) FROM running_sessions")).isZero();
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
        assertThat(count("SELECT count(*) FROM courses WHERE id=?", course)).isEqualTo(1);
    }

    @Test
    void nonConsentingUserUsesAnonymousPopulationPath() throws Exception {
        consentService.change(userId, false);
        personalPlan.answer =
                (u, g) -> {
                    assertThat(u).isNull();
                    return Optional.of(
                            new Result(
                                    null,
                                    null,
                                    BigDecimal.valueOf(1000),
                                    BigDecimal.valueOf(360),
                                    List.of(
                                            new Segment(
                                                    1,
                                                    BigDecimal.ZERO,
                                                    BigDecimal.valueOf(1000),
                                                    BigDecimal.valueOf(360),
                                                    BigDecimal.ONE))));
                };
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":1000}"))
                .andExpect(status().isCreated());
    }

    @Test
    void fixedPaceDoesNotCallAi() throws Exception {
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{"
                                        + devices()
                                        + ",\"targetDistanceM\":5000,\"targetPaceSecPerKm\":300}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.segments.length()").value(0));
        assertThat(personalPlan.calls.get()).isZero();
    }

    @Test
    void contradictoryMeanAndSegmentsAreNotStored() throws Exception {
        personalPlan.answer =
                (u, g) ->
                        Optional.of(
                                new Result(
                                        null,
                                        u,
                                        BigDecimal.valueOf(1000),
                                        BigDecimal.valueOf(500),
                                        List.of(
                                                new Segment(
                                                        1,
                                                        BigDecimal.ZERO,
                                                        BigDecimal.valueOf(1000),
                                                        BigDecimal.valueOf(300),
                                                        BigDecimal.ONE))));
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":1000}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    @Test
    void consentRevokedWhileAiRunsCannotStorePersonalResult() throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        personalPlan.answer =
                (u, g) -> {
                    entered.countDown();
                    try {
                        if (!release.await(5, TimeUnit.SECONDS))
                            throw new AssertionError("not released");
                    } catch (InterruptedException e) {
                        throw new RuntimeException(e);
                    }
                    return Optional.of(
                            new Result(
                                    null,
                                    u,
                                    BigDecimal.valueOf(1000),
                                    BigDecimal.valueOf(360),
                                    List.of(
                                            new Segment(
                                                    1,
                                                    BigDecimal.ZERO,
                                                    BigDecimal.valueOf(1000),
                                                    BigDecimal.valueOf(360),
                                                    BigDecimal.ONE))));
                };
        try (var pool = Executors.newSingleThreadExecutor()) {
            var result =
                    pool.submit(
                            () ->
                                    mockMvc.perform(
                                            createRequest(
                                                    userId,
                                                    "{"
                                                            + devices()
                                                            + ",\"targetDistanceM\":1000}")));
            try {
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
                consentService.change(userId, false);
            } finally {
                release.countDown();
            }
            result.get(10, TimeUnit.SECONDS).andExpect(status().isConflict());
        }
        assertThat(count("SELECT count(*) FROM running_sessions")).isZero();
    }

    @Test
    void existingSessionRecoveryNeverCallsUnavailableAi() throws Exception {
        long session = insertReadySession();
        personalPlan.answer =
                (u, g) -> {
                    throw new AssertionError("must not call AI");
                };
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":5000}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ACTIVE_SESSION_EXISTS"));
        assertThat(personalPlan.calls.get()).isZero();
        assertThat(count("SELECT count(*) FROM running_sessions WHERE id=?", session)).isEqualTo(1);
    }

    @Test
    void failedGoalRecalculationPreservesGoalPlanAndVersion() throws Exception {
        long session = insertReadySession();
        mockMvc.perform(
                        patchRequest(
                                userId,
                                session,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":1000}"))
                .andExpect(status().isOk());
        long plan =
                jdbc.queryForObject(
                        "SELECT id FROM pace_plans WHERE session_id=?", Long.class, session);
        personalPlan.answer = (u, g) -> Optional.empty();
        mockMvc.perform(
                        patchRequest(
                                userId,
                                session,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":2,\"targetDistanceM\":2000}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(stateVersion(session)).isEqualTo(2);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT id FROM pace_plans WHERE session_id=?",
                                Long.class,
                                session))
                .isEqualTo(plan);
        mockMvc.perform(getRequest(userId, session))
                .andExpect(jsonPath("$.goal.targetDistanceM").value(1000));
    }

    @Test
    void personalRatiosOverrideStoredCourseRatiosAndPreserveTime() throws Exception {
        long course = insertCourse("ACTIVE", "2000");
        jdbc.update(
                "INSERT INTO"
                    + " course_segment_difficulties(course_id,distance_m,ratios,planner_version)"
                    + " VALUES (?,2000,'[0.8,1.2]'::jsonb,'test')",
                course);
        personalPlan.answer =
                (u, g) ->
                        Optional.of(
                                new Result(
                                        course,
                                        u,
                                        BigDecimal.valueOf(2000),
                                        BigDecimal.valueOf(300),
                                        List.of(
                                                new Segment(
                                                        1,
                                                        BigDecimal.ZERO,
                                                        BigDecimal.valueOf(1000),
                                                        BigDecimal.valueOf(330),
                                                        new BigDecimal("1.1")),
                                                new Segment(
                                                        2,
                                                        BigDecimal.valueOf(1000),
                                                        BigDecimal.valueOf(2000),
                                                        BigDecimal.valueOf(270),
                                                        new BigDecimal("0.9")))));
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{"
                                        + devices()
                                        + ",\"courseId\":"
                                        + course
                                        + ",\"targetDurationSec\":600}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.segments[0].recommendedPaceSecPerKm").value(330))
                .andExpect(jsonPath("$.plan.segments[1].recommendedPaceSecPerKm").value(270));
    }

    @Test
    void lateGoalCalculationCannotOverwriteNewerPatch() throws Exception {
        long session = insertReadySession();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        personalPlan.answer =
                (u, g) -> {
                    entered.countDown();
                    try {
                        if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError();
                    } catch (InterruptedException e) {
                        throw new RuntimeException(e);
                    }
                    return Optional.of(
                            new Result(
                                    null,
                                    u,
                                    BigDecimal.valueOf(1000),
                                    BigDecimal.valueOf(360),
                                    List.of(
                                            new Segment(
                                                    1,
                                                    BigDecimal.ZERO,
                                                    BigDecimal.valueOf(1000),
                                                    BigDecimal.valueOf(360),
                                                    BigDecimal.ONE))));
                };
        try (var pool = Executors.newSingleThreadExecutor()) {
            var pending =
                    pool.submit(
                            () ->
                                    mockMvc.perform(
                                            patchRequest(
                                                    userId,
                                                    session,
                                                    "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":1000}")));
            try {
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
                mockMvc.perform(
                                patchRequest(
                                        userId,
                                        session,
                                        "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetPaceSecPerKm\":300}"))
                        .andExpect(status().isOk());
            } finally {
                release.countDown();
            }
            pending.get(10, TimeUnit.SECONDS).andExpect(status().isConflict());
        }
        mockMvc.perform(getRequest(userId, session))
                .andExpect(jsonPath("$.goal.targetPaceSecPerKm").value(300))
                .andExpect(jsonPath("$.goal.targetDistanceM").isEmpty());
    }

    @Test
    void paceRoundingToZeroIsRejectedBeforePersistence() throws Exception {
        personalPlan.answer =
                (u, g) ->
                        Optional.of(
                                new Result(
                                        null,
                                        u,
                                        BigDecimal.valueOf(1000),
                                        new BigDecimal("0.004"),
                                        List.of(
                                                new Segment(
                                                        1,
                                                        BigDecimal.ZERO,
                                                        BigDecimal.valueOf(1000),
                                                        new BigDecimal("0.004"),
                                                        BigDecimal.ONE))));
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":1000}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    @Test
    void pendingStartPreventsLateGoalReplacement() throws Exception {
        long session = insertReadySession();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        personalPlan.answer =
                (u, g) -> {
                    entered.countDown();
                    try {
                        if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError();
                    } catch (InterruptedException e) {
                        throw new RuntimeException(e);
                    }
                    return Optional.of(
                            new Result(
                                    null,
                                    u,
                                    BigDecimal.valueOf(1000),
                                    BigDecimal.valueOf(360),
                                    List.of(
                                            new Segment(
                                                    1,
                                                    BigDecimal.ZERO,
                                                    BigDecimal.valueOf(1000),
                                                    BigDecimal.valueOf(360),
                                                    BigDecimal.ONE))));
                };
        try (var pool = Executors.newSingleThreadExecutor()) {
            var pending =
                    pool.submit(
                            () ->
                                    mockMvc.perform(
                                            patchRequest(
                                                    userId,
                                                    session,
                                                    "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":1000}")));
            try {
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
                mockMvc.perform(postControl(userId, session, "start", requestBody(watchId, 1)))
                        .andExpect(status().isOk());
            } finally {
                release.countDown();
            }
            pending.get(10, TimeUnit.SECONDS)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("COMMAND_PENDING"));
        }
        assertThat(count("SELECT count(*) FROM pace_plans WHERE session_id=?", session)).isZero();
        assertThat(stateVersion(session)).isEqualTo(1);
    }
}
