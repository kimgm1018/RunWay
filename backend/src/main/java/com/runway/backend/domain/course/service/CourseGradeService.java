package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonLineString;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.TreeSet;

/**
 * 경로 → DEM 고도 → 저장 가능한 경사. DB·인증·외부 API를 호출하지 않는 내부 계산 서비스다. 검증된 DEM을 준비한 후 호출부에서 생성/주입한다. 파일 경로·운영
 * 데이터의 자동 선택은 하지 않는다.
 */
public final class CourseGradeService {
    private static final double EARTH_RADIUS_M = 6_371_008.8;
    private static final double RESAMPLE_M = 20;

    /** 외부 호출 전 계산 작업량 보호. 20m 표본 약 2만 km까지이며 공개 API의 거리 정책이 아니다. */
    private static final int MAX_DEM_SAMPLES = 1_000_000;

    private final ElevationSource elevationSource;

    public CourseGradeService(ElevationSource elevationSource) {
        this.elevationSource = Objects.requireNonNull(elevationSource);
    }

    public List<GradeSegment> calculate(GeoJsonLineString route, BigDecimal distanceM) {
        return calculate(route, distanceM, List.of());
    }

    /** 양 끝 거리는 측정하고 내부를 보간한다. 경로만으로 다리/터널을 추측하지 않는다. */
    public record UnmeasuredSection(double startDistanceM, double endDistanceM) {
        public UnmeasuredSection {
            // Double의 정렬은 -0.0과 +0.0을 구별하므로 거리 격자에 넣기 전에 정규화한다.
            if (startDistanceM == 0) startDistanceM = 0;
            if (endDistanceM == 0) endDistanceM = 0;
        }
    }

    public List<GradeSegment> calculate(
            GeoJsonLineString route, BigDecimal distanceM, List<UnmeasuredSection> sections) {
        BigDecimal storedDistance = GradeProfileCalculator.normalizeDistance(distanceM);
        double distance = storedDistance.doubleValue();
        if (route == null || sections == null) throw invalidRoute();
        // 메모리나 DEM I/O 작업을 시작하기 전에 계산 가능 여부를 확인한다.
        if (Math.ceil(distance / RESAMPLE_M) + 1 + route.positionCount() + 2L * sections.size()
                > MAX_DEM_SAMPLES) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        for (var section : sections) {
            if (section == null
                    || !Double.isFinite(section.startDistanceM())
                    || !Double.isFinite(section.endDistanceM())
                    || section.startDistanceM() < 0
                    || section.startDistanceM() >= section.endDistanceM()
                    || section.endDistanceM() > distance) throw invalidRoute();
        }
        // Route의 연속된 bridge/tunnel edge run처럼 겹치거나 맞닿는 구간을 하나로 취급한다.
        var ordered = new ArrayList<>(sections);
        ordered.sort(Comparator.comparingDouble(UnmeasuredSection::startDistanceM));
        List<UnmeasuredSection> merged = new ArrayList<>();
        for (var section : ordered) {
            if (!merged.isEmpty() && section.startDistanceM() <= merged.getLast().endDistanceM()) {
                var previous = merged.removeLast();
                merged.add(
                        new UnmeasuredSection(
                                previous.startDistanceM(),
                                Math.max(previous.endDistanceM(), section.endDistanceM())));
            } else {
                merged.add(section);
            }
        }
        List<List<Double>> points = new ArrayList<>();
        List<Double> cumulative = new ArrayList<>();
        double physicalDistance = 0;
        for (var point : route.coordinates()) {
            if (points.isEmpty()) {
                points.add(point);
                cumulative.add(0.0);
            } else {
                double next = physicalDistance + haversine(points.getLast(), point);
                if (next > physicalDistance) {
                    physicalDistance = next;
                    points.add(point);
                    cumulative.add(physicalDistance);
                }
            }
        }
        if (physicalDistance == 0) throw invalidRoute();
        TreeSet<Double> samples = new TreeSet<>();
        samples.add(0.0);
        samples.add(distance);
        for (long i = 1; i * RESAMPLE_M < distance; i++) samples.add(i * RESAMPLE_M);
        for (double x : cumulative) samples.add(x / physicalDistance * distance);
        for (var section : merged) {
            samples.add(section.startDistanceM());
            samples.add(section.endDistanceM());
        }
        double[] xs = new double[samples.size()];
        double[] zs = new double[samples.size()];
        double[] pathXs = cumulative.stream().mapToDouble(Double::doubleValue).toArray();
        int index = 0;
        int sectionIndex = 0;
        for (double x : samples) {
            xs[index] = x;
            while (sectionIndex < merged.size() && merged.get(sectionIndex).endDistanceM() <= x) {
                sectionIndex++;
            }
            boolean unknown =
                    sectionIndex < merged.size() && x > merged.get(sectionIndex).startDistanceM();
            if (unknown) {
                zs[index++] = Double.NaN;
                continue;
            }
            double pathX = x / distance * physicalDistance;
            int position = Arrays.binarySearch(pathXs, pathX);
            double longitude;
            double latitude;
            if (position >= 0) {
                longitude = points.get(position).get(0);
                latitude = points.get(position).get(1);
            } else {
                int right = Math.min(-position - 1, points.size() - 1);
                int left = right - 1;
                double ratio = (pathX - pathXs[left]) / (pathXs[right] - pathXs[left]);
                var a = points.get(left);
                var b = points.get(right);
                longitude = wrapLongitude(a.get(0) + longitudeDelta(a.get(0), b.get(0)) * ratio);
                latitude = a.get(1) + (b.get(1) - a.get(1)) * ratio;
            }
            zs[index++] = elevationSource.elevationAt(longitude, latitude);
        }
        return GradeProfileCalculator.calculate(storedDistance, xs, zs);
    }

    private static double haversine(List<Double> a, List<Double> b) {
        double latA = Math.toRadians(a.get(1));
        double latB = Math.toRadians(b.get(1));
        double sinLat = Math.sin((latB - latA) / 2);
        double sinLon = Math.sin(Math.toRadians(longitudeDelta(a.get(0), b.get(0))) / 2);
        double h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLon * sinLon;
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.clamp(h, 0, 1)));
    }

    private static double longitudeDelta(double from, double to) {
        return wrapLongitude(to - from);
    }

    private static double wrapLongitude(double longitude) {
        return ((longitude + 180) % 360 + 360) % 360 - 180;
    }

    private static ApiException invalidRoute() {
        return GradeProfileValidator.invalid("route", "유효한 경로와 코스 안의 미확인 구간이 필요합니다.");
    }
}
