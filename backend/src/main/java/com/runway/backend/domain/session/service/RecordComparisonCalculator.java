package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseInterval;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * 기록 비교(S15P31E105-422, sessions.md "기록 비교")의 순수 계산. 운동시간·거리 곡선은 종료 후 분석과 같은 규칙({@link
 * PostRunAnalysisCalculator})을 쓴다.
 */
public final class RecordComparisonCalculator {

    private RecordComparisonCalculator() {}

    /**
     * 한 러닝의 (누적거리 m, 운동시간 초) 곡선. 원점에서 시작하며 거리·시간이 줄지 않는다.
     *
     * @param points 곡선 점
     * @param lastDistanceAt 누적거리가 있는 마지막 샘플까지의 운동시간(초). 샘플이 없으면 0
     */
    public record Track(List<double[]> points, double lastDistanceAt) {

        public Track {
            points = List.copyOf(points);
        }

        /** 곡선이 도달한 최대 거리(m). */
        public double distance() {
            return points.get(points.size() - 1)[0];
        }

        /** distance에 처음 도달한 운동시간(초). 도달하지 않았으면 null. */
        Double timeAt(double distance) {
            return PostRunAnalysisCalculator.timeAtDistance(points, distance);
        }
    }

    /** AVAILABLE 비교 결과. 거리는 m 버림, 시간은 초 반올림. */
    public record Gap(int distanceM, int currentElapsedSec, int pastElapsedSec) {}

    /**
     * @param startedAt 실제 시작시각(필수)
     * @param until 운동시간 계산 상한. 종료된 러닝은 종료시각, 진행 중이면 계산 시각
     * @param samples 측정시각 순 샘플(누적거리 없는 샘플은 무시)
     * @param pauseResumeEvents 적용시각 순 APPLIED PAUSE/RESUME
     */
    public static Track track(
            Instant startedAt,
            Instant until,
            List<AnalysisSample> samples,
            List<PauseResumeEvent> pauseResumeEvents) {
        Instant end = until.isBefore(startedAt) ? startedAt : until;
        List<PauseInterval> pauses =
                PostRunAnalysisCalculator.pauseIntervals(pauseResumeEvents, startedAt, end);
        BigDecimal total = PostRunAnalysisCalculator.lastDistance(samples);
        List<double[]> points =
                PostRunAnalysisCalculator.distanceTrack(samples, total, startedAt, end, pauses);
        double lastAt = 0;
        for (AnalysisSample sample : samples) {
            if (sample.totalDistance() != null) {
                lastAt =
                        Math.max(
                                lastAt,
                                PostRunAnalysisCalculator.movingSecondsAt(
                                        sample.measuredAt(), startedAt, end, pauses));
            }
        }
        return new Track(points, lastAt);
    }

    /**
     * 현재 러닝이 마지막으로 도달한 거리에서 두 러닝의 운동시간을 비교한다. 현재 거리가 과거 총거리를 넘으면 과거 총거리에서 비교한다.
     *
     * @return 현재 거리가 없으면(0 이하) null. past는 거리가 있어야 한다
     */
    public static Gap compare(Track current, Track past) {
        double currentDistance = current.distance();
        double pastDistance = past.distance();
        if (currentDistance <= 0 || pastDistance <= 0) {
            return null;
        }
        double at;
        double currentTime;
        if (currentDistance > pastDistance) {
            at = pastDistance;
            currentTime = current.timeAt(pastDistance);
        } else {
            at = currentDistance;
            currentTime = current.lastDistanceAt();
        }
        double pastTime = past.timeAt(at);
        return new Gap((int) Math.floor(at), (int) Math.round(currentTime), (int) Math.round(pastTime));
    }
}
