package com.runway.backend.domain.grouprun.pace;

import com.runway.backend.domain.coaching.decide.CoachingInputAssembler;
import com.runway.backend.domain.coaching.decide.CoachingSource;
import com.runway.backend.domain.grouprun.helper.GroupGuidePaceCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunFitCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator;
import com.runway.backend.domain.grouprun.live.GroupRunLiveRanking;
import com.runway.backend.domain.grouprun.repository.GroupRunFitJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunRow;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.SessionCoachingRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;
import com.runway.backend.domain.session.service.SegmentDifficultyProvider;
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
    private final SegmentDifficultyProvider difficulty;
    private final ApplicationEventPublisher events;
    private final JsonMapper mapper;
    private final TransactionTemplate tx;
    private final GroupRunFitJdbcRepository fits;

    public GroupPaceService(@Value("${runway.group-pace.enabled:false}") boolean enabled,
            GroupPaceRepository states, GroupRunJdbcRepository groups,
            GroupRunParticipantJdbcRepository participants, SessionCoachingRepository coaching,
            SessionReferenceRepository references, GroupPacePort ai, PersonalPacePlanPort plans,
            ApplicationEventPublisher events, JsonMapper mapper, PlatformTransactionManager manager,
            GroupRunFitJdbcRepository fits, SegmentDifficultyProvider difficulty) {
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
        this.fits = fits;
        this.difficulty = difficulty;
    }

    public boolean isEnabled() { return enabled; }

    /** Read only. OFF does not even query the new table. */
    public Optional<GroupPaceRepository.State> stored(long groupId) {
        return enabled ? states.find(groupId) : Optional.empty();
    }

    /**
     * km paces of the stored start plan (S15P31E105-739). OFF reads nothing. A stored value that cannot be read (only
     * possible after a manual DB edit) shows no segments instead of failing G03 (review B-5).
     */
    public List<GroupPaceRepository.SegmentPace> storedStartSegments(long groupId) {
        if (!enabled) return List.of();
        try {
            return states.findStartSegments(groupId);
        } catch (org.springframework.dao.DataAccessException | NullPointerException e) {
            org.slf4j.LoggerFactory.getLogger(GroupPaceService.class)
                    .warn("group start segments unreadable groupId={}", groupId);
            return List.of();
        }
    }

    /**
     * 기동 시 한 번 다시 계산할 예정 그룹런(S15P31E105-817): 출발 페이스는 있는데 km 비율이 없는 것(V39 배포 전에 계산됨). 기능이
     * 꺼져 있으면 테이블을 읽지 않는다.
     */
    public List<Long> startBackfillTargets(int limit) {
        return enabled ? states.findStartBackfillTargets(limit) : List.of();
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
        // GOAL holds the goal from the first evaluation, not the measured median (review A-2).
        if (current == null && state.goalMode()) current = goalPace(group);
        // TOGETHER starts at the stored AI recommendation until AI10 first decides (S15P31E105-750, G17 / 702).
        if (current == null && !state.goalMode()) current = state.startPace();
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
        Integer goalPace = goalPace(group);
        return new RunningInput(new GroupPacePort.Request(groupId, current, goalPace, state.startPace(),
                (int) Math.min(Integer.MAX_VALUE, Math.max(0, Duration.between(started, now).getSeconds())),
                progressRatio(activeDistances, goalDistance), now, state.direction() == null ? null
                        : new GroupPacePort.LastChange(state.direction(), state.changedAt()), inputs,
                state.goalMode() && goalPace != null ? GroupPaceRepository.MODE_GOAL : null),
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
    record StartInput(GroupRunRow group, Instant token, List<Ranked> selected, boolean goalMode,
            java.util.Map<Long, Integer> displayedPaces, SessionGoal planningGoal, BigDecimal planningDistance) {}

    /**
     * 동의한 후보 본인의 최근 페이스. 대기방 '참가자 편한 범위'(G03 comfortRange)에 들어가는 그 사람의 값과 같은 계산이다
     * (최근 완료 5회 평균, S15P31E105-785. 1 km·이동 10분 미만 기록 제외, 886). 초기 설정 페이스 대체는 하지 않는다. 비동의 참가자의 기록은 읽지 않는다.
     */
    java.util.Map<Long, Integer> displayedPaces(List<GroupPaceRepository.Candidate> consented) {
        if (consented.isEmpty()) return java.util.Map.of();
        var recent = fits.findRecentCompletedPaces(consented.stream()
                .map(GroupPaceRepository.Candidate::userId).toList());
        var result = new java.util.HashMap<Long, Integer>();
        if (recent == null) return result;
        for (var c : consented) {
            Integer pace = GroupRunFitCalculator.recentPaceSecPerKm(recent.get(c.userId()));
            if (pace != null) result.put(c.userId(), pace);
        }
        return result;
    }

    static List<Ranked> selectSlowest(List<Ranked> ranked) {
        var result = new ArrayList<>(ranked.stream().filter(r -> r.recentPace() == null).toList());
        result.addAll(ranked.stream().filter(r -> r.recentPace() != null)
                .sorted(Comparator.comparing(Ranked::recentPace).reversed()
                        .thenComparing(r -> r.candidate().userId())).limit(3).toList());
        return result;
    }

    /**
     * Host-only mode change before the run (S15P31E105-680). Called inside the caller's transaction after its
     * host/status checks. Stores the mode even when the feature is off; a recalculation follows only when on.
     */
    public void changeMode(long groupId, String mode) {
        states.saveMode(groupId, mode);
        membershipOrGoalChanged(groupId);
    }

    /** @return 새 출발 추천을 저장했으면 true. 계산할 수 없거나 변경에 밀려 버렸으면 false. */
    public boolean evaluateStart(long groupId) {
        if (!enabled) return false;
        StartInput input = tx.execute(status -> {
            references.lockGroupRun(groupId);
            var state = states.find(groupId).orElse(null);
            if (state == null) return null;
            var group = groups.findById(groupId).orElse(null);
            if (group == null || !"SCHEDULED".equals(group.status())
                    || group.goalDistance() == null || group.goalDistance() <= 0) {
                states.abandonStart(groupId, state.updatedAt());
                return null;
            }
            var consented = states.candidates(groupId).stream()
                    .filter(GroupPaceRepository.Candidate::consent).toList();
            var ranked = consented.stream()
                    .map(candidate -> new Ranked(candidate,
                    GroupRunFitCalculator.recentPaceSecPerKm(states.recentPaces(
                            candidate.userId(), group.goalDistance())))).toList();
            var selected = selectSlowest(ranked);
            if (selected.isEmpty()) {
                states.abandonStart(groupId, state.updatedAt());
                return null;
            }
            var course = group.courseId() == null ? null
                    : coaching.courseGrade(group.courseId()).orElse(null);
            // AI09 resolves stored grades, legacy elevations and the configured missing-grade policy.
            boolean useCourse = course != null && course.distanceM() != null
                    && course.distanceM().signum() > 0;
            var goal = useCourse ? new SessionGoal(group.courseId(), null, null, null, null)
                    : new SessionGoal(null, null, group.goalDistance(), null, null);
            var distance = useCourse ? course.distanceM() : BigDecimal.valueOf(group.goalDistance());
            return new StartInput(group, state.updatedAt(), selected, state.goalMode(),
                    displayedPaces(consented), goal, distance);
        });
        if (input == null) return false;
        var goal = input.planningGoal();
        Integer goalPace = goalPace(input.group());
        Integer aiPace = null;
        Long basis = null;
        List<GroupPaceRepository.SegmentRatio> segments = List.of();
        int slower = 0;
        boolean basisBoundaryHit = false;
        for (var selected : input.selected()) {
            var candidate = selected.candidate();
            if (candidate.consent() && !states.consented(candidate.userId())) {
                abandon(groupId, input.token());
                return false;
            }
            var result = plans.plan(candidate.userId(), goal);
            var state = states.find(groupId).orElse(null);
            // Superseded by a newer join/leave/edit/mode change: that calculation owns the state now.
            if (state == null || !java.util.Objects.equals(state.updatedAt(), input.token())) return false;
            if (result.isEmpty() || result.get().pace() == null || result.get().pace().signum() <= 0
                    || result.get().distance() == null
                    || result.get().distance().compareTo(input.planningDistance()) != 0
                    || !java.util.Objects.equals(result.get().courseId(), goal.courseId())
                    || !java.util.Objects.equals(result.get().userId(), candidate.userId())) {
                abandon(groupId, input.token());
                return false;
            }
            int pace = result.get().pace().setScale(0, RoundingMode.HALF_UP).intValueExact();
            if (aiPace == null || pace > aiPace) {
                aiPace = pace;
                basis = candidate.userId();
                basisBoundaryHit = result.get().paceSearchBoundaryHit();
                segments = segmentRatios(result.get(), input.planningDistance());
            }
            if (goalPace != null && pace > goalPace) slower++;
        }
        // S15P31E105-785: AI09 cannot plan slower than its search range, so a member slower than that range comes back
        // faster than they actually run. Only in that direction (the basis member's own recent pace is slower than the
        // plan), bring the recommendation down to that member's own recent pace: consented data only, inside the range.
        Integer basisPace = basis == null ? null : input.displayedPaces().get(basis);
        // S15P31E105-886: a target slower than walking-speed sanity (0.5 m/s, AI09 SPEED_REF_VALID_RANGE_MPS) is not a
        // running pace (e.g. 185'27"/km in production); keep the AI09 plan instead.
        if (basisBoundaryHit && basisPace != null && aiPace < basisPace
                && basisPace > MAX_CLAMP_PACE_SEC_PER_KM) {
            org.slf4j.LoggerFactory.getLogger(GroupPaceService.class).info(
                    "GROUP_PACE_START_CLAMP_SKIPPED groupRunId={} basisUserId={} aiPace={} basisRecentPace={}",
                    groupId, basis, aiPace, basisPace);
            basisPace = null;
        }
        if (basisBoundaryHit && basisPace != null && aiPace < basisPace) {
            org.slf4j.LoggerFactory.getLogger(GroupPaceService.class).info(
                    "GROUP_PACE_START_CLAMPED groupRunId={} basisUserId={} aiPace={} basisRecentPace={}",
                    groupId, basis, aiPace, basisPace);
            aiPace = basisPace;
        }
        // Each mode applies its own value (S15P31E105-702): TOGETHER ('AI 추천') the AI recommendation as it is,
        // without max(goal, AI); GOAL the host's goal.
        int applied = input.goalMode() && goalPace != null ? goalPace : aiPace;
        var start = new GroupPaceRepository.Start(applied, aiPace, basis,
                goalPace == null ? null : slower, segments.isEmpty()
                        ? fallbackRatios(goal.courseId(), input.planningDistance()) : segments);
        return Boolean.TRUE.equals(tx.execute(status -> {
            references.lockGroupRun(groupId);
            if (input.selected().stream().anyMatch(r -> r.candidate().consent()
                    && !states.consented(r.candidate().userId()))) {
                states.abandonStart(groupId, input.token());
                return false;
            }
            return states.saveStart(groupId, input.token(), start);
        }));
    }

    private List<GroupPaceRepository.SegmentRatio> fallbackRatios(Long courseId, BigDecimal distance) {
        BigDecimal step = BigDecimal.valueOf(1000);
        int count = distance.divide(step, 0, RoundingMode.CEILING).intValueExact();
        if (count > 45) return List.of();
        var ranges = new ArrayList<GroupPaceRepository.SegmentRatio>(count);
        for (int i = 0; i < count; i++) {
            BigDecimal start = step.multiply(BigDecimal.valueOf(i));
            ranges.add(new GroupPaceRepository.SegmentRatio(
                    start, distance.min(start.add(step)), BigDecimal.ONE));
        }
        var stored = count > 1 && courseId != null
                ? difficulty.ratios(courseId, distance, count).orElse(List.of()) : List.<BigDecimal>of();
        if (stored.size() != count || stored.stream().anyMatch(ratio -> ratio == null || ratio.signum() <= 0)) {
            return ranges;
        }
        var weighted = BigDecimal.ZERO;
        for (int i = 0; i < count; i++) {
            var range = ranges.get(i);
            weighted = weighted.add(stored.get(i).multiply(range.endDistanceM().subtract(range.startDistanceM())));
        }
        var mean = weighted.divide(distance, java.math.MathContext.DECIMAL64);
        var normalized = stored.stream().map(ratio -> ratio.divide(mean, java.math.MathContext.DECIMAL64)).toList();
        if (normalized.stream().anyMatch(ratio -> ratio.compareTo(MIN_RATIO) < 0
                || ratio.compareTo(MAX_RATIO) > 0)) return ranges;
        for (int i = 0; i < count; i++) {
            var range = ranges.get(i);
            ranges.set(i, new GroupPaceRepository.SegmentRatio(
                    range.startDistanceM(), range.endDistanceM(), normalized.get(i)));
        }
        return ranges;
    }

    /** Slowest pace the 785 clamp may move to: 0.5 m/s, AI09 SPEED_REF_VALID_RANGE_MPS lower bound (S15P31E105-886). */
    static final int MAX_CLAMP_PACE_SEC_PER_KM = 2000;

    static final BigDecimal MIN_RATIO = new BigDecimal("0.85");
    static final BigDecimal MAX_RATIO = new BigDecimal("1.20");

    /**
     * The basis plan's km segments as ratios of its mean (S15P31E105-739). Kept only when, as S01 checks them
     * (SessionPlanPreparation.valid), they tile the goal distance from 0 in 1 km steps (the last one shorter), each pace
     * is the mean x its ratio, ratios stay inside AI09's 0.85~1.20 and their distance-weighted mean is 1; otherwise
     * empty, so G03 shows the single start pace as before.
     */
    static List<GroupPaceRepository.SegmentRatio> segmentRatios(
            PersonalPacePlanPort.Result result, int distanceM) {
        return segmentRatios(result, BigDecimal.valueOf(distanceM));
    }

    static List<GroupPaceRepository.SegmentRatio> segmentRatios(
            PersonalPacePlanPort.Result result, BigDecimal distanceM) {
        List<GroupPaceRepository.SegmentRatio> ratios = new ArrayList<>();
        BigDecimal end = BigDecimal.ZERO;
        BigDecimal weighted = BigDecimal.ZERO;
        int sequence = 1;
        for (var segment : result.segments()) {
            if (segment.sequence() != sequence++
                    || segment.start() == null || segment.end() == null || segment.ratio() == null
                    || segment.start().compareTo(end) != 0
                    || segment.end().compareTo(segment.start()) <= 0
                    || segment.end().compareTo(distanceM
                            .min(segment.start().add(BigDecimal.valueOf(1000)))) != 0
                    || segment.ratio().compareTo(MIN_RATIO) < 0
                    || segment.ratio().compareTo(MAX_RATIO) > 0
                    || segment.pace() == null || result.pace() == null
                    || result.pace().multiply(segment.ratio()).subtract(segment.pace()).abs()
                            .compareTo(new BigDecimal("0.02")) > 0) {
                return List.of();
            }
            ratios.add(new GroupPaceRepository.SegmentRatio(segment.start(), segment.end(),
                    segment.ratio()));
            weighted = weighted.add(segment.end().subtract(segment.start()).multiply(segment.ratio()));
            end = segment.end();
        }
        if (end.compareTo(distanceM) != 0
                || weighted.divide(distanceM, java.math.MathContext.DECIMAL64)
                        .subtract(BigDecimal.ONE).abs().compareTo(new BigDecimal("0.01")) > 0) {
            return List.of();
        }
        return ratios;
    }

    private void abandon(long groupId, Instant token) {
        tx.execute(status -> states.abandonStart(groupId, token));
    }

    private static Integer goalPace(GroupRunRow group) {
        return GroupRunGoalCalculator.derivePaceSecPerKm(group.goalDistance(), group.goalDuration());
    }
}
