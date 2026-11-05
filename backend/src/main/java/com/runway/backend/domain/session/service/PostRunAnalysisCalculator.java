package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.entity.AnalysisSplit;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.SessionAnalysisStats;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * 종료 후 분석(S15P31E105-312)의 순수 계산. DB·Spring에 의존하지 않아 단위 테스트에서 바로 호출할 수 있다.
 *
 * <p>확정 규칙
 *
 * <ul>
 *   <li>운동시간(movingDuration)은 시작~종료 실제 경과시간에서 일시정지 구간을 뺀다. 일시정지 구간은 적용된 PAUSE~RESUME이며, RESUME 없이 종료되면
 *       종료시각까지다.
 *   <li>총거리는 마지막 null이 아닌 누적거리 샘플 값이다. GPS로 다시 계산하지 않는다.
 *   <li>1km 구간은 누적거리가 1000m 배수에 처음 도달한 운동시간을 샘플 사이 선형 보간으로 구한다. 마지막 구간은 1km보다 짧을 수 있고, 1km 미만 러닝은
 *       구간 하나다. 구간 페이스 = 구간 운동시간(초) / (구간 거리(m) / 1000).
 *   <li>심박·케이던스는 측정된(null이 아닌) 샘플만 평균한다. 하나도 없으면 null이다.
 * </ul>
 */
public final class PostRunAnalysisCalculator {

    private static final BigDecimal KM = BigDecimal.valueOf(1000);
    /** NUMERIC(10,2)에 들어가지 못하는 페이스는 저장하지 않고 null로 둔다. */
    private static final BigDecimal PACE_LIMIT = BigDecimal.valueOf(100_000_000L);

    private PostRunAnalysisCalculator() {}

    /** 적용된 PAUSE/RESUME 명령 한 건. */
    public record PauseResumeEvent(ControlAction action, Instant appliedAt) {}

    /** 일시정지 구간. 시작·종료시각으로 잘려 있고 서로 겹치지 않는다. */
    public record PauseInterval(Instant start, Instant end) {}

    public record Result(SessionAnalysisStats stats, List<AnalysisSplit> splits) {}

    /**
     * @param startedAt 실제 시작시각(필수)
     * @param endedAt 실제 종료시각(필수, 시작보다 늦어야 함)
     * @param goalDistanceM 목표 거리(m), 없으면 null
     * @param goalDurationSec 목표 시간(초), 없으면 null
     * @param samples 측정시각 순으로 정렬된 샘플
     * @param pauseResumeEvents 적용시각 순으로 정렬된 APPLIED PAUSE/RESUME 명령
     */
    public static Result calculate(
            Instant startedAt,
            Instant endedAt,
            Integer goalDistanceM,
            Integer goalDurationSec,
            List<AnalysisSample> samples,
            List<PauseResumeEvent> pauseResumeEvents) {
        if (startedAt == null || endedAt == null || !endedAt.isAfter(startedAt)) {
            throw new IllegalArgumentException("startedAt/endedAt are required and ended must follow started");
        }
        List<PauseInterval> pauses = pauseIntervals(pauseResumeEvents, startedAt, endedAt);
        long elapsedMs = ChronoUnit.MILLIS.between(startedAt, endedAt);
        long pausedMs = pauses.stream().mapToLong(p -> ChronoUnit.MILLIS.between(p.start(), p.end())).sum();
        int elapsedSec = toSeconds(elapsedMs);
        int movingSec = toSeconds(Math.max(0, elapsedMs - pausedMs));

        BigDecimal totalDistance = lastDistance(samples);
        List<double[]> track = distanceTrack(samples, totalDistance, startedAt, endedAt, pauses);

        List<AnalysisSplit> splits = buildSplits(samples, totalDistance, track);
        BigDecimal averagePace = pace(BigDecimal.valueOf(movingSec), totalDistance);

        Integer movingToGoal = null;
        Boolean goalAchieved = null;
        if (goalDistanceM != null) {
            if (totalDistance != null) {
                if (totalDistance.compareTo(BigDecimal.valueOf(goalDistanceM)) >= 0) {
                    Double reached = timeAtDistance(track, goalDistanceM);
                    if (reached != null) {
                        movingToGoal = (int) Math.round(reached);
                        goalAchieved = goalDurationSec == null || movingToGoal <= goalDurationSec;
                    }
                } else {
                    goalAchieved = false;
                }
            }
        } else if (goalDurationSec != null) {
            goalAchieved = movingSec >= goalDurationSec;
        }

        Average hr = new Average();
        Average cadence = new Average();
        BigDecimal maxHr = null;
        for (AnalysisSample sample : samples) {
            hr.add(sample.heartRate());
            cadence.add(sample.cadence());
            if (sample.heartRate() != null && (maxHr == null || sample.heartRate().compareTo(maxHr) > 0)) {
                maxHr = sample.heartRate();
            }
        }

        SessionAnalysisStats stats =
                new SessionAnalysisStats(
                        totalDistance,
                        movingSec,
                        elapsedSec,
                        movingToGoal,
                        goalAchieved,
                        averagePace,
                        hr.value(),
                        cadence.value(),
                        maxHr);
        return new Result(stats, splits);
    }

    /**
     * APPLIED PAUSE/RESUME 순서에서 일시정지 구간을 만든다. 이미 일시정지 중의 PAUSE와 일시정지 중이 아닌 RESUME은 무시한다. 닫히지 않은 PAUSE는
     * 종료시각까지로 보고, 모든 구간은 [시작, 종료]로 자른다.
     */
    public static List<PauseInterval> pauseIntervals(
            List<PauseResumeEvent> events, Instant startedAt, Instant endedAt) {
        List<PauseInterval> result = new ArrayList<>();
        Instant pausedSince = null;
        for (PauseResumeEvent event : events) {
            if (event.appliedAt() == null) {
                continue;
            }
            if (event.action() == ControlAction.PAUSE && pausedSince == null) {
                pausedSince = event.appliedAt();
            } else if (event.action() == ControlAction.RESUME && pausedSince != null) {
                addClamped(result, pausedSince, event.appliedAt(), startedAt, endedAt);
                pausedSince = null;
            }
        }
        if (pausedSince != null) {
            addClamped(result, pausedSince, endedAt, startedAt, endedAt);
        }
        return result;
    }

    private static void addClamped(
            List<PauseInterval> out, Instant start, Instant end, Instant from, Instant to) {
        Instant s = start.isBefore(from) ? from : start;
        Instant e = end.isAfter(to) ? to : end;
        if (e.isAfter(s)) {
            out.add(new PauseInterval(s, e));
        }
    }

    /** 시작부터 t까지의 운동시간(초). 일시정지 구간은 제외한다. */
    static double movingSecondsAt(
            Instant t, Instant startedAt, Instant endedAt, List<PauseInterval> pauses) {
        Instant at = t.isBefore(startedAt) ? startedAt : t.isAfter(endedAt) ? endedAt : t;
        long totalMs = ChronoUnit.MILLIS.between(startedAt, at);
        long pausedMs = 0;
        for (PauseInterval pause : pauses) {
            if (!pause.start().isBefore(at)) {
                break;
            }
            Instant end = pause.end().isAfter(at) ? at : pause.end();
            pausedMs += ChronoUnit.MILLIS.between(pause.start(), end);
        }
        return (totalMs - pausedMs) / 1000.0;
    }

    static BigDecimal lastDistance(List<AnalysisSample> samples) {
        BigDecimal last = null;
        for (AnalysisSample sample : samples) {
            if (sample.totalDistance() != null) {
                last = sample.totalDistance();
            }
        }
        return last;
    }

    /**
     * (누적거리 m, 운동시간 초) 점 목록. 원점에서 시작해 거리가 늘어난 샘플만 담는다. 거리는 감소하지 않게 하고 총거리를 넘지 않게 자른다. 시간은 감소하지
     * 않는다.
     */
    static List<double[]> distanceTrack(
            List<AnalysisSample> samples,
            BigDecimal totalDistance,
            Instant startedAt,
            Instant endedAt,
            List<PauseInterval> pauses) {
        List<double[]> track = new ArrayList<>();
        track.add(new double[] {0, 0});
        if (totalDistance == null) {
            return track;
        }
        double cap = totalDistance.doubleValue();
        double maxDistance = 0;
        double lastTime = 0;
        for (AnalysisSample sample : samples) {
            if (sample.totalDistance() == null) {
                continue;
            }
            maxDistance = Math.min(Math.max(maxDistance, sample.totalDistance().doubleValue()), cap);
            double time =
                    Math.max(lastTime, movingSecondsAt(sample.measuredAt(), startedAt, endedAt, pauses));
            lastTime = time;
            if (maxDistance > track.get(track.size() - 1)[0]) {
                track.add(new double[] {maxDistance, time});
            }
        }
        return track;
    }

    /** 누적거리가 처음 distance에 도달한 운동시간(초). 도달하지 않았으면 null. */
    static Double timeAtDistance(List<double[]> track, double distance) {
        if (distance <= 0) {
            return 0.0;
        }
        for (int i = 1; i < track.size(); i++) {
            double[] prev = track.get(i - 1);
            double[] cur = track.get(i);
            if (cur[0] >= distance) {
                double ratio = (distance - prev[0]) / (cur[0] - prev[0]);
                return prev[1] + ratio * (cur[1] - prev[1]);
            }
        }
        return null;
    }

    private static List<AnalysisSplit> buildSplits(
            List<AnalysisSample> samples, BigDecimal totalDistance, List<double[]> track) {
        if (totalDistance == null || totalDistance.signum() <= 0) {
            return List.of();
        }
        List<BigDecimal[]> ranges = new ArrayList<>();
        for (BigDecimal start = BigDecimal.ZERO;
                start.compareTo(totalDistance) < 0;
                start = start.add(KM)) {
            BigDecimal end = start.add(KM).min(totalDistance);
            ranges.add(new BigDecimal[] {start, end});
        }

        Average[] hr = new Average[ranges.size()];
        Average[] cadence = new Average[ranges.size()];
        for (int i = 0; i < ranges.size(); i++) {
            hr[i] = new Average();
            cadence[i] = new Average();
        }
        // 거리가 없는 샘플은 직전 누적거리 구간에 속한다. 경계 거리는 앞 구간에 속한다.
        double cap = totalDistance.doubleValue();
        double current = 0;
        for (AnalysisSample sample : samples) {
            if (sample.totalDistance() != null) {
                current = Math.min(Math.max(current, sample.totalDistance().doubleValue()), cap);
            }
            int index = current <= 0 ? 0 : (int) Math.ceil(current / 1000.0) - 1;
            index = Math.min(Math.max(index, 0), ranges.size() - 1);
            hr[index].add(sample.heartRate());
            cadence[index].add(sample.cadence());
        }

        List<AnalysisSplit> splits = new ArrayList<>();
        for (int i = 0; i < ranges.size(); i++) {
            BigDecimal start = ranges.get(i)[0];
            BigDecimal end = ranges.get(i)[1];
            Double startTime = timeAtDistance(track, start.doubleValue());
            Double endTime = timeAtDistance(track, end.doubleValue());
            BigDecimal splitPace = null;
            if (startTime != null && endTime != null && endTime > startTime) {
                splitPace =
                        pace(
                                BigDecimal.valueOf(endTime - startTime),
                                end.subtract(start));
            }
            splits.add(new AnalysisSplit(start, end, splitPace, hr[i].value(), cadence[i].value()));
        }
        return splits;
    }

    /** 초/km 페이스(소수 둘째 자리 반올림). 거리가 없거나 시간이 0 이하거나 저장 범위를 넘으면 null. */
    private static BigDecimal pace(BigDecimal seconds, BigDecimal distanceM) {
        if (distanceM == null || distanceM.signum() <= 0 || seconds.signum() <= 0) {
            return null;
        }
        BigDecimal pace = seconds.multiply(KM).divide(distanceM, 2, RoundingMode.HALF_UP);
        return pace.signum() > 0 && pace.compareTo(PACE_LIMIT) < 0 ? pace : null;
    }

    private static int toSeconds(long millis) {
        return (int) ((millis + 500) / 1000);
    }

    /** 측정된 값만 평균한다. 값이 없으면 null(0이 아님). */
    private static final class Average {
        private BigDecimal sum = BigDecimal.ZERO;
        private int count;

        void add(BigDecimal value) {
            if (value != null) {
                sum = sum.add(value);
                count++;
            }
        }

        BigDecimal value() {
            return count == 0
                    ? null
                    : sum.divide(BigDecimal.valueOf(count), 2, RoundingMode.HALF_UP);
        }
    }
}
