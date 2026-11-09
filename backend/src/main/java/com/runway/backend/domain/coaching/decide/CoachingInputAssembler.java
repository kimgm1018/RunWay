package com.runway.backend.domain.coaching.decide;

import com.runway.backend.domain.coaching.decide.CoachingSource.GradeSegment;
import com.runway.backend.domain.coaching.decide.CoachingSource.Plan;
import com.runway.backend.domain.coaching.decide.CoachingSource.PlanSegment;
import com.runway.backend.domain.coaching.decide.CoachingSource.Sample;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;

/**
 * DB 스냅샷({@link CoachingSource})으로 AI04 요청을 만든다(S15P31E105-421 플랜 3장 "입력 구성"). DB·시계에 의존하지 않는 순수 계산이다.
 *
 * <p>입력이 부족하거나 오래됐으면 요청을 만들지 않는다. 가짜 측정값으로 채우지 않는다(pace-coaching.md "코칭 입력·20초 유효성").
 */
public final class CoachingInputAssembler {

    /** 5초 간격 기록 한 칸. */
    static final int STEP_SEC = 5;

    /** 보내는 기록 길이(최근 30분). AI 상한(MAX_HISTORY=1440)보다 작게 두어 DB 조회와 본문 크기를 줄인다. */
    public static final int HISTORY_CELLS = 360;

    /** 미래 계획 칸 수(t0+5초 ~ t0+120초). */
    static final int FUTURE_STEPS = 24;

    /**
     * 입력 기준시각이 이만큼 오래되면 AI를 부르지 않는다. 계약상 유효시간 20초에서 발행 하한(남은 5초)과 AI 호출 상한(3초)을 뺀 값이다. 이보다
     * 오래된 입력은 불러도 발행 단계에서 반드시 버려지고 세션의 15초 호출 허가만 쓰게 된다(재검토 R-1).
     */
    public static final Duration INPUT_STALE_AFTER = Duration.ofSeconds(12);

    /** 후보 페이스 = 기준 페이스 + 이 값(초/km). 순서가 계약이다. */
    static final int[] CANDIDATE_DELTAS = {-10, -5, 0, 5, 10};

    /** 실측 평균으로 기준 페이스를 정할 때 쓰는 최근 구간. */
    static final int MEASURED_PACE_WINDOW_SEC = 60;

    /** 기준 페이스 허용 범위(초/km). 벗어나면 후보를 만들 수 없는 입력으로 본다. */
    static final BigDecimal MIN_ANCHOR = new BigDecimal("120");

    static final BigDecimal MAX_ANCHOR = new BigDecimal("1800");

    static final BigDecimal GOAL_PREFERENCE = new BigDecimal("0.5");

    private CoachingInputAssembler() {}

    public enum Skip {
        /** t0 심박 또는 속도 측정이 없다. */
        INPUT_INSUFFICIENT,
        /** 입력 기준시각이 12초 이상 지났다(발행 가능한 유효시간이 남지 않는다). */
        INPUT_STALE,
        /** 기준 페이스를 정할 수 없다. */
        NO_ANCHOR_PACE
    }

    /**
     * @param inputAsOf 필수 지표(심박·속도)별 최신 측정시각과 t0 표본 측정시각 중 가장 오래된 시각. 서버 시각보다 늦으면 서버 시각
     * @param anchorPace 현재 안내 페이스로 본 후보 기준 페이스
     */
    public record Assembled(PaceDecideRequest request, Instant inputAsOf, BigDecimal anchorPace) {}

    public record Result(Assembled assembled, Skip skip) {
        static Result skip(Skip reason) {
            return new Result(null, reason);
        }
    }

    public static Result assemble(CoachingSource source, Instant now) {
        List<Sample> samples = source.samples();
        if (samples.isEmpty()) {
            return Result.skip(Skip.INPUT_INSUFFICIENT);
        }
        Instant hrAt = latestAt(samples, Sample::heartRateBpm);
        Instant speedAt = latestAt(samples, Sample::speedMps);
        if (hrAt == null || speedAt == null) {
            return Result.skip(Skip.INPUT_INSUFFICIENT);
        }
        // t0는 경과초가 가장 큰 표본이다. 경과초가 되돌아간 기록에서 오래된 t0를 최신으로 보내지 않도록 그 측정시각도 기준에 넣는다(리뷰 B-3).
        // 경과초가 같은 표본이 여럿이면 가장 최근 측정을 t0로 본다(재검토 R-4).
        Sample t0 =
                samples.stream()
                        .max(Comparator.comparingInt(Sample::elapsedSec)
                                .thenComparing(Sample::measuredAt))
                        .orElseThrow();
        Instant inputAsOf = earliest(hrAt, speedAt, t0.measuredAt());
        // 기기 시각이 서버보다 앞선 표본은 지금 측정된 것으로 본다. 만료가 서버 기준 20초를 넘지 않게 한다(리뷰 B-5).
        if (inputAsOf.isAfter(now)) {
            inputAsOf = now;
        }
        if (!now.isBefore(inputAsOf.plus(INPUT_STALE_AFTER))) {
            return Result.skip(Skip.INPUT_STALE);
        }

        int t0Elapsed = t0.elapsedSec();
        PaceDecideRequest.History history = history(samples, t0Elapsed);
        if (history.hrBpm().get(history.hrBpm().size() - 1) == null) {
            // AI 일반 예측은 t0 실측 심박이 필요하다(ai-service.md AI04).
            return Result.skip(Skip.INPUT_INSUFFICIENT);
        }

        double distanceM = latestValue(samples, Sample::totalDistanceM, 0.0);
        boolean course = source.courseDistanceM() != null;
        Double routeProgressM = course ? routeProgress(source, samples) : null;
        double planPosition = routeProgressM != null ? routeProgressM : distanceM;

        BigDecimal anchor = anchorPace(source, samples, t0Elapsed, planPosition);
        if (anchor == null) {
            return Result.skip(Skip.NO_ANCHOR_PACE);
        }

        List<PaceDecideRequest.Candidate> candidates = new ArrayList<>(CANDIDATE_DELTAS.length);
        for (int delta : CANDIDATE_DELTAS) {
            BigDecimal pace = anchor.add(BigDecimal.valueOf(delta));
            double speed = 1000.0 / pace.doubleValue();
            candidates.add(
                    new PaceDecideRequest.Candidate(
                            pace,
                            Collections.nCopies(FUTURE_STEPS, speed),
                            futureGrade(source.gradeProfile(), routeProgressM, speed)));
        }

        var lastCoaching =
                source.lastAppliedCoaching() == null
                        ? null
                        : new PaceDecideRequest.LastCoaching(
                                source.lastAppliedCoaching().coachingId(),
                                source.lastAppliedCoaching().appliedAt());
        var context =
                new PaceDecideRequest.Context(
                        source.sessionId(),
                        source.stateVersion(),
                        "RUNNING",
                        mode(source),
                        new PaceDecideRequest.Goal(
                                source.goalDistanceM(),
                                source.goalDurationSec(),
                                source.goalPaceSecPerKm()),
                        GOAL_PREFERENCE,
                        planSegments(source.plan()),
                        anchor,
                        anchor,
                        t0Elapsed,
                        distanceM,
                        routeProgressM,
                        inputAsOf,
                        lastCoaching,
                        source.guidePaceSetAt(),
                        source.lastResumedAt());
        var request =
                new PaceDecideRequest(
                        t0Elapsed,
                        source.startedAt(),
                        source.userId(),
                        history,
                        candidates,
                        context,
                        false);
        return new Result(new Assembled(request, inputAsOf, anchor), null);
    }

    /** 러닝 mode(ai-service.md N7-3 잠정 enum). */
    static String mode(CoachingSource source) {
        if (source.courseDistanceM() != null) {
            return "COURSE";
        }
        boolean goal =
                source.goalDistanceM() != null
                        || source.goalDurationSec() != null
                        || source.goalPaceSecPerKm() != null;
        return goal ? "FREE_WITH_GOAL" : "FREE_NO_GOAL";
    }

    /**
     * 경과초를 5초 칸으로 묶어 칸마다 지표별 마지막 측정값을 쓴다. 마지막 칸은 t0가 든 칸이고, 최근 {@link #HISTORY_CELLS}칸만 보낸다.
     * 측정이 없는 칸은 null이다.
     */
    static PaceDecideRequest.History history(List<Sample> samples, int t0Elapsed) {
        int lastCell = t0Elapsed / STEP_SEC;
        int firstCell = Math.max(0, lastCell - HISTORY_CELLS + 1);
        int size = lastCell - firstCell + 1;
        List<Double> hr = new ArrayList<>(Collections.nCopies(size, null));
        List<Double> speed = new ArrayList<>(Collections.nCopies(size, null));
        List<Double> grade = new ArrayList<>(Collections.nCopies(size, null));
        // 표본은 경과초 오름차순이므로 뒤에 온 값이 같은 칸의 마지막 측정이다.
        for (Sample sample : samples) {
            int cell = sample.elapsedSec() / STEP_SEC - firstCell;
            if (cell < 0 || cell >= size) {
                continue;
            }
            if (sample.heartRateBpm() != null) hr.set(cell, sample.heartRateBpm());
            if (sample.speedMps() != null) speed.set(cell, sample.speedMps());
            if (sample.gradePercent() != null) grade.set(cell, sample.gradePercent());
        }
        return new PaceDecideRequest.History(hr, speed, grade);
    }

    /**
     * 현재 안내 페이스. 마지막 적용 코칭 → 현재 위치의 계획 구간 → 계획 추천 페이스 → 목표 페이스 → 최근 60초 실측 평균 순으로 정한다. AI 문서는 실측
     * 페이스를 넣으면 추천이 튈 수 있다고 하므로 실측은 다른 값이 모두 없을 때만 쓴다.
     */
    static BigDecimal anchorPace(
            CoachingSource source, List<Sample> samples, int t0Elapsed, double planPosition) {
        BigDecimal pace = null;
        if (source.lastAppliedCoaching() != null) {
            pace = source.lastAppliedCoaching().recommendedPace();
        }
        if (pace == null && source.plan() != null) {
            pace = planPaceAt(source.plan(), planPosition);
            if (pace == null) {
                pace = source.plan().recommendedPace();
            }
        }
        if (pace == null) {
            pace = source.goalPaceSecPerKm();
        }
        if (pace == null) {
            pace = measuredPace(samples, t0Elapsed);
        }
        if (pace == null) {
            return null;
        }
        pace = pace.setScale(2, RoundingMode.HALF_UP);
        if (pace.compareTo(MIN_ANCHOR) < 0 || pace.compareTo(MAX_ANCHOR) > 0) {
            return null;
        }
        return pace;
    }

    static BigDecimal planPaceAt(Plan plan, double position) {
        List<PlanSegment> segments = plan.segments();
        for (int i = 0; i < segments.size(); i++) {
            PlanSegment s = segments.get(i);
            boolean last = i == segments.size() - 1;
            double start = s.startDistanceM().doubleValue();
            double end = s.endDistanceM().doubleValue();
            if (position >= start && (position < end || (last && position <= end))) {
                return s.pace();
            }
        }
        return null;
    }

    private static BigDecimal measuredPace(List<Sample> samples, int t0Elapsed) {
        double sum = 0;
        int n = 0;
        for (Sample sample : samples) {
            if (sample.elapsedSec() > t0Elapsed - MEASURED_PACE_WINDOW_SEC
                    && sample.speedMps() != null
                    && sample.speedMps() > 0) {
                sum += sample.speedMps();
                n++;
            }
        }
        if (n == 0) {
            return null;
        }
        return BigDecimal.valueOf(1000.0 / (sum / n));
    }

    /** 계획 구간 비율 = 구간 페이스 ÷ 계획 추천 페이스(ai-service.md O7). */
    static List<PaceDecideRequest.PlanSegment> planSegments(Plan plan) {
        if (plan == null || plan.segments().isEmpty() || plan.recommendedPace().signum() <= 0) {
            return null;
        }
        double base = plan.recommendedPace().doubleValue();
        List<PaceDecideRequest.PlanSegment> result = new ArrayList<>();
        for (PlanSegment s : plan.segments()) {
            double start = s.startDistanceM().doubleValue();
            double end = s.endDistanceM().doubleValue();
            if (end <= start || s.pace().signum() <= 0) {
                return null;
            }
            result.add(new PaceDecideRequest.PlanSegment(start, end, s.pace().doubleValue() / base));
        }
        return result;
    }

    /**
     * 코스 진행거리. 워치는 routeProgressM을 보내지 않으므로(BatchFormat) 저장값이 없으면 누적 거리를 코스 거리 안으로 잘라 쓴다. 코스를 처음부터
     * 따라 달린다고 보는 근사다.
     */
    static Double routeProgress(CoachingSource source, List<Sample> samples) {
        Double stored = latestValue(samples, Sample::routeProgressM, null);
        if (stored != null) {
            return stored;
        }
        Double distance = latestValue(samples, Sample::totalDistanceM, null);
        if (distance == null) {
            return null;
        }
        return Math.min(distance, source.courseDistanceM().doubleValue());
    }

    /**
     * t0+5k초(k=1..24)에 도달할 위치의 100m 경사. 위치가 하나라도 경사 목록 밖이면 모름(null)으로 보낸다(AI는 빈 칸이 하나라도 있으면 모름으로 본다).
     */
    static List<Double> futureGrade(
            List<GradeSegment> profile, Double routeProgressM, double speedMps) {
        if (profile == null || profile.isEmpty() || routeProgressM == null) {
            return null;
        }
        List<Double> grades = new ArrayList<>(FUTURE_STEPS);
        for (int k = 1; k <= FUTURE_STEPS; k++) {
            Double grade = gradeAt(profile, routeProgressM + speedMps * STEP_SEC * k);
            if (grade == null) {
                return null;
            }
            grades.add(grade);
        }
        return grades;
    }

    static Double gradeAt(List<GradeSegment> profile, double position) {
        for (int i = 0; i < profile.size(); i++) {
            GradeSegment s = profile.get(i);
            boolean last = i == profile.size() - 1;
            if (position >= s.startDistanceM()
                    && (position < s.endDistanceM() || (last && position <= s.endDistanceM()))) {
                return s.gradePercent();
            }
        }
        return null;
    }

    private static Instant earliest(Instant... values) {
        Instant result = values[0];
        for (Instant value : values) {
            if (value.isBefore(result)) {
                result = value;
            }
        }
        return result;
    }

    private static Instant latestAt(List<Sample> samples, Function<Sample, Double> metric) {
        Instant latest = null;
        for (Sample sample : samples) {
            if (metric.apply(sample) != null
                    && (latest == null || sample.measuredAt().isAfter(latest))) {
                latest = sample.measuredAt();
            }
        }
        return latest;
    }

    private static Double latestValue(
            List<Sample> samples, Function<Sample, Double> metric, Double fallback) {
        for (int i = samples.size() - 1; i >= 0; i--) {
            Double value = metric.apply(samples.get(i));
            if (value != null) {
                return value;
            }
        }
        return fallback;
    }
}
