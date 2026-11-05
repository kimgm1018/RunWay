package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * AI course_grade.py와 같은 20m 재표본 → 중앙값 5칸 → 평균 3칸 → 100m 경사. 필터는 구간 경계에서 필요한 표본만 평가한다. 코스 길이에 비례하는
 * 격자 할당은 없다.
 */
public final class GradeProfileCalculator {
    private static final double RESAMPLE_M = 20;
    private static final double MIN_ELEVATION_M = -500;
    private static final double MAX_ELEVATION_M = 9000;
    private static final BigDecimal MIN_UNROUNDED_DISTANCE_M = new BigDecimal("0.005");

    private GradeProfileCalculator() {}

    /** 결측(NaN/비유한/고도 범위 밖)은 인접 유효 고도로 보간한다. 입력 배열은 변경하지 않는다. */
    public static List<GradeSegment> calculate(
            BigDecimal distanceM, double[] distancesM, double[] elevationsM) {
        BigDecimal storedDistance = normalizeDistance(distanceM);
        double distance = storedDistance.doubleValue();
        if (distancesM == null
                || elevationsM == null
                || distancesM.length < 2
                || distancesM.length != elevationsM.length) {
            throw GradeProfileValidator.invalid("elevations", "고도와 거리가 2개 이상 필요합니다.");
        }
        double[] knownX = new double[distancesM.length];
        double[] knownZ = new double[distancesM.length];
        int known = 0;
        for (int i = 0; i < distancesM.length; i++) {
            double x = distancesM[i];
            // 원래 거리와 저장 거리의 차이는 반올림으로 생길 수 있다.
            if (!Double.isFinite(x)
                    || x < 0
                    || x > distanceM.doubleValue()
                    || (i > 0 && x <= distancesM[i - 1])) {
                throw GradeProfileValidator.invalid("elevations", "거리는 코스 안에서 증가해야 합니다.");
            }
            double z = elevationsM[i];
            if (Double.isFinite(z) && z >= MIN_ELEVATION_M && z <= MAX_ELEVATION_M) {
                knownX[known] = x;
                knownZ[known++] = z;
            }
        }
        if (known < 2) throw unavailable();
        var profile =
                new SmoothedProfile(
                        distance, Arrays.copyOf(knownX, known), Arrays.copyOf(knownZ, known));
        BigDecimal step = GradeProfileValidator.stepFor(storedDistance);
        List<GradeSegment> segments = new ArrayList<>();
        List<Double> centres = new ArrayList<>();
        List<Double> grades = new ArrayList<>();
        for (BigDecimal start = BigDecimal.ZERO;
                start.compareTo(storedDistance) < 0;
                start = start.add(step)) {
            BigDecimal end = start.add(step).min(storedDistance);
            double grade =
                    (profile.at(end.doubleValue()) - profile.at(start.doubleValue()))
                            / end.subtract(start).doubleValue()
                            * 100;
            centres.add(start.add(end).doubleValue() / 2);
            grades.add(Math.abs(grade) <= 100 ? grade : Double.NaN);
            segments.add(new GradeSegment(start, end, null));
        }
        double[] gradeX = new double[grades.size()];
        double[] gradeZ = new double[grades.size()];
        int valid = 0;
        for (int i = 0; i < grades.size(); i++) {
            if (Double.isFinite(grades.get(i))) {
                gradeX[valid] = centres.get(i);
                gradeZ[valid++] = grades.get(i);
            }
        }
        if (valid == 0) throw unavailable();
        gradeX = Arrays.copyOf(gradeX, valid);
        gradeZ = Arrays.copyOf(gradeZ, valid);
        for (int i = 0; i < segments.size(); i++) {
            double grade = grades.get(i);
            if (!Double.isFinite(grade)) grade = interpolate(centres.get(i), gradeX, gradeZ);
            var segment = segments.get(i);
            segments.set(
                    i,
                    new GradeSegment(
                            segment.startDistanceM(),
                            segment.endDistanceM(),
                            BigDecimal.valueOf(grade).setScale(4, RoundingMode.HALF_EVEN)));
        }
        return GradeProfileValidator.validate(segments, storedDistance);
    }

    static BigDecimal normalizeDistance(BigDecimal distance) {
        // setScale 전 0으로 반올림되는 수를 거절해 극소 지수에서 거대한 10의 거듭제곱 연산을 막는다.
        if (distance == null
                || distance.compareTo(MIN_UNROUNDED_DISTANCE_M) < 0
                || distance.compareTo(GradeProfileValidator.MAX_DISTANCE_M) > 0) {
            throw GradeProfileValidator.invalid("distanceM", "거리 저장 범위 안의 양수여야 합니다.");
        }
        BigDecimal normalized = distance.setScale(2, RoundingMode.HALF_UP);
        if (normalized.signum() == 0) {
            throw GradeProfileValidator.invalid("distanceM", "반올림한 거리는 0보다 커야 합니다.");
        }
        return normalized;
    }

    private static ApiException unavailable() {
        return new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
    }

    private static double interpolate(double x, double[] xs, double[] zs) {
        if (x <= xs[0]) return zs[0];
        int last = xs.length - 1;
        if (x >= xs[last]) return zs[last];
        int index = Arrays.binarySearch(xs, x);
        if (index >= 0) return zs[index];
        int right = -index - 1;
        int left = right - 1;
        return zs[left] + (zs[right] - zs[left]) * ((x - xs[left]) / (xs[right] - xs[left]));
    }

    private record SmoothedProfile(double distance, double[] xs, double[] zs) {
        private long size() {
            return (long) Math.ceil(distance / RESAMPLE_M) + 1;
        }

        private double gridX(long index) {
            return index == size() - 1 ? distance : index * RESAMPLE_M;
        }

        private long clamped(long index) {
            return Math.clamp(index, 0, size() - 1);
        }

        private double median(long index) {
            if (size() < 5) return interpolate(gridX(index), xs, zs);
            double[] window = new double[5];
            for (int i = 0; i < 5; i++) {
                window[i] = interpolate(gridX(clamped(index + i - 2)), xs, zs);
            }
            Arrays.sort(window);
            return window[2];
        }

        private double mean(long index) {
            if (size() < 3) return median(index);
            return (median(clamped(index - 1)) + median(index) + median(clamped(index + 1))) / 3;
        }

        private double at(double x) {
            if (x >= distance) return mean(size() - 1);
            long left = (long) Math.floor(x / RESAMPLE_M);
            double fraction = (x - gridX(left)) / (gridX(left + 1) - gridX(left));
            return mean(left) + (mean(left + 1) - mean(left)) * fraction;
        }
    }
}
