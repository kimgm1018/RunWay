package com.runway.backend.domain.grouprun.pace;

import com.runway.backend.domain.coaching.decide.CoachingInputAssembler;
import com.runway.backend.domain.coaching.decide.CoachingSource;
import com.runway.backend.domain.grouprun.helper.GroupGuidePaceCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunFitCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator;
import com.runway.backend.domain.grouprun.live.GroupRunLiveRanking;
import com.runway.backend.domain.grouprun.repository.GroupRunJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunRow;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.SessionCoachingRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Service
public class GroupPaceService {
    private final boolean enabled;
    private final GroupPaceRepository states;
    private final GroupRunJdbcRepository groups;
    private final GroupRunParticipantJdbcRepository participants;
    private final SessionCoachingRepository coaching;
    private final SessionReferenceRepository references;
    private final GroupPacePort ai;
    private final PersonalPacePlanPort plans;
    private final ApplicationEventPublisher events;
    private final JsonMapper mapper;
    private final TransactionTemplate tx;

    public GroupPaceService(@Value("${runway.group-pace.enabled:false}") boolean enabled,
            GroupPaceRepository states, GroupRunJdbcRepository groups,
            GroupRunParticipantJdbcRepository participants, SessionCoachingRepository coaching,
            SessionReferenceRepository references, GroupPacePort ai, PersonalPacePlanPort plans,
            ApplicationEventPublisher events, JsonMapper mapper, PlatformTransactionManager manager) {
        this.enabled = enabled;
        this.states = states;
        this.groups = groups;
        this.participants = participants;
        this.coaching = coaching;
        this.references = references;
        this.ai = ai;
        this.plans = plans;
        this.events = events;
        this.mapper = mapper;
        this.tx = new TransactionTemplate(manager);
    }

    public boolean isEnabled() { return enabled; }

    /** Read only. OFF does not even query the new table. */
    public Optional<GroupPaceRepository.State> stored(long groupId) {
        return enabled ? states.find(groupId) : Optional.empty();
    }

    /** Called inside the existing group mutation transaction. */
    public void membershipOrGoalChanged(long groupId) {
        if (!enabled) return;
        states.invalidateStart(groupId);
        events.publishEvent(new GroupPaceChanged(groupId));
    }

    public void onBatch(long sessionId) {
        if (!enabled) return;
        references.findGroupRunId(sessionId).ifPresent(this::evaluateRunning);
    }

    public Optional<Long> groupForBatch(long sessionId) {
        return enabled ? references.findGroupRunId(sessionId) : Optional.empty();
    }

    record RunningInput(GroupPacePort.Request request, Instant token) {}

    public void evaluateRunning(long groupId) {
        if (!enabled) return;
        RunningInput prepared = tx.execute(status -> runningInput(groupId, Instant.now()));
        if (prepared == null) return;
        GroupPacePort.Request request = prepared.request();
        // Recheck after assembling every runner, since another runner's queries can take time.
        if (request.participants().stream().anyMatch(p -> p.userId() != null
                && !states.consented(p.userId()))) return;
        if (Instant.now().isAfter(request.now().plusSeconds(5))) return;
        // Acquire only after preparation. An input based on a superseded state cannot call AI.
        Optional<Instant> lease = tx.execute(status -> states.reserve(groupId, prepared.token()));
        if (lease == null || lease.isEmpty()) return;
        // Deliberately outside the snapshot/store transactions. Never log input or response.
        ai.evaluate(request).ifPresent(result -> tx.execute(status -> {
            references.lockGroupRun(groupId);
            return states.saveRunning(groupId, lease.get(), result, request.now());
        }));
    }

    private RunningInput runningInput(long groupId, Instant now) {
        var group = groups.findById(groupId).orElse(null);
        if (group == null || !"RUNNING".equals(group.status())) return null;
        var state = states.find(groupId).orElse(
                new GroupPaceRepository.State(null, null, null, null, 0, null));
        if (state.updatedAt() != null && now.isBefore(state.updatedAt().plusSeconds(30))) return null;
        Integer current = state.pace();
        if (current == null) current = GroupGuidePaceCalculator.medianSecPerKmFromBigDecimals(
                participants.findRunningParticipantGuidePaces(groupId,
                        now.plusSeconds(GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS)));
        if (current == null) current = GroupGuidePaceCalculator.medianSecPerKmFromBigDecimals(
                participants.findParticipantProfilePaces(groupId));
        if (current == null) return null;
        List<GroupPacePort.Participant> inputs = new ArrayList<>();
        List<BigDecimal> activeDistances = new ArrayList<>();
        Instant started = null;
        var live = references.findGroupLiveRows(groupId,
                now.plusSeconds(GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS));
        for (var runner : states.runners(groupId)) {
            if (started == null || runner.startedAt().isBefore(started)) started = runner.startedAt();
            var row = live.stream().filter(r -> r.userId() == runner.userId()).findFirst().orElse(null);
            boolean active = "RUNNING".equals(runner.status()) && row != null
                    && row.totalDistance() != null && row.measuredAt() != null
                    && !row.measuredAt().isBefore(now.minusSeconds(GroupRunLiveRanking.GPS_TTL_SECONDS))
                    && !row.measuredAt().isAfter(now.plusSeconds(
                            GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS));
            if (active) activeDistances.add(row.totalDistance());
            var samples = active ? coaching.recentSamples(runner.sessionId(), 1800, runner.consent())
                    : List.<CoachingSource.Sample>of();
            int elapsed = samples.stream().mapToInt(CoachingSource.Sample::elapsedSec).max().orElse(0);
            var history = CoachingInputAssembler.history(samples, elapsed);
            List<Double> future = null;
            if (active && group.courseId() != null && !samples.isEmpty()) {
                var course = coaching.courseGrade(group.courseId()).orElse(null);
                if (course != null) {
                    var latest = samples.getLast();
                    Double progress = latest.routeProgressM() != null ? latest.routeProgressM()
                            : latest.totalDistanceM();
                    future = CoachingInputAssembler.futureGrade(profile(course.profileJson()),
                            progress, 1000.0 / current);
                }
            }
            inputs.add(new GroupPacePort.Participant(runner.consent() ? runner.userId() : null,
                    active, history, future));
        }
        if (started == null) return null;
        started = states.startedAt(groupId).orElse(started);
        BigDecimal goalDistance = group.goalDistance() == null ? null
                : BigDecimal.valueOf(group.goalDistance());
        if (group.courseId() != null) {
            goalDistance = coaching.courseGrade(group.courseId())
                    .map(SessionCoachingRepository.CourseGrade::distanceM).orElse(goalDistance);
        }
        return new RunningInput(new GroupPacePort.Request(groupId, current, goalPace(group), state.startPace(),
                (int) Math.min(Integer.MAX_VALUE, Math.max(0, Duration.between(started, now).getSeconds())),
                progressRatio(activeDistances, goalDistance), now, state.direction() == null ? null
                        : new GroupPacePort.LastChange(state.direction(), state.changedAt()), inputs),
                state.updatedAt());
    }

    private static Double progressRatio(List<BigDecimal> distances, BigDecimal goalDistance) {
        if (goalDistance == null || goalDistance.signum() <= 0 || distances.isEmpty()) return null;
        var sorted = distances.stream().sorted().toList();
        int middle = sorted.size() / 2;
        BigDecimal median = sorted.get(middle);
        if (sorted.size() % 2 == 0) {
            median = median.add(sorted.get(middle - 1)).divide(BigDecimal.valueOf(2));
        }
        return Math.clamp(median.doubleValue() / goalDistance.doubleValue(), 0.0, 1.0);
    }

    private List<CoachingSource.GradeSegment> profile(String json) {
        if (json == null) return null;
        try {
            var root = mapper.readTree(json);
            if (!root.isArray()) return null;
            List<CoachingSource.GradeSegment> result = new ArrayList<>();
            for (var node : root) {
                if (!node.path("startDistanceM").isNumber() || !node.path("endDistanceM").isNumber()
                        || !node.path("gradePercent").isNumber()) return null;
                result.add(new CoachingSource.GradeSegment(node.get("startDistanceM").doubleValue(),
                        node.get("endDistanceM").doubleValue(), node.get("gradePercent").doubleValue()));
            }
            return result;
        } catch (RuntimeException e) { return null; }
    }

    record Ranked(GroupPaceRepository.Candidate candidate, Integer recentPace) {}
    record StartInput(GroupRunRow group, Instant token, List<Ranked> selected) {}

    static List<Ranked> selectSlowest(List<Ranked> ranked) {
        var result = new ArrayList<>(ranked.stream().filter(r -> r.recentPace() == null).toList());
        result.addAll(ranked.stream().filter(r -> r.recentPace() != null)
                .sorted(Comparator.comparing(Ranked::recentPace).reversed()
                        .thenComparing(r -> r.candidate().userId())).limit(3).toList());
        return result;
    }

    public void evaluateStart(long groupId) {
        if (!enabled) return;
        StartInput input = tx.execute(status -> {
            references.lockGroupRun(groupId);
            var group = groups.findById(groupId).orElse(null);
            if (group == null || !"SCHEDULED".equals(group.status())
                    || group.goalDistance() == null || group.goalDistance() <= 0) return null;
            var state = states.find(groupId).orElse(null);
            if (state == null) return null;
            var ranked = states.candidates(groupId).stream()
                    .filter(GroupPaceRepository.Candidate::consent)
                    .map(candidate -> new Ranked(candidate,
                    GroupRunFitCalculator.recentPaceSecPerKm(states.recentPaces(
                            candidate.userId(), group.goalDistance())))).toList();
            return new StartInput(group, state.updatedAt(), selectSlowest(ranked));
        });
        if (input == null || input.selected().isEmpty()) return;
        var goal = new SessionGoal(null, null, input.group().goalDistance(), null, null);
        Integer recommended = goalPace(input.group());
        for (var selected : input.selected()) {
            var candidate = selected.candidate();
            if (candidate.consent() && !states.consented(candidate.userId())) return;
            var result = plans.plan(candidate.userId(), goal);
            var state = states.find(groupId).orElse(null);
            if (state == null || !java.util.Objects.equals(state.updatedAt(), input.token())) return;
            if (result.isEmpty() || result.get().pace() == null || result.get().pace().signum() <= 0
                    || result.get().distance() == null
                    || result.get().distance().compareTo(BigDecimal.valueOf(goal.distanceM())) != 0
                    || !java.util.Objects.equals(result.get().userId(), candidate.userId())) return;
            int pace = result.get().pace().setScale(0, RoundingMode.HALF_UP).intValueExact();
            recommended = recommended == null ? pace : Math.max(recommended, pace);
        }
        int pace = recommended;
        tx.execute(status -> {
            references.lockGroupRun(groupId);
            if (input.selected().stream().anyMatch(r -> r.candidate().consent()
                    && !states.consented(r.candidate().userId()))) return false;
            return states.saveStart(groupId, input.token(), pace);
        });
    }

    private static Integer goalPace(GroupRunRow group) {
        return GroupRunGoalCalculator.derivePaceSecPerKm(group.goalDistance(), group.goalDuration());
    }
}
