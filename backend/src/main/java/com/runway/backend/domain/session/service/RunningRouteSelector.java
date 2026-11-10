package com.runway.backend.domain.session.service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * S11 표시용 경로 선택(sessions.md S11 경로 선택 규칙, 통합 설계 9.7). 저장된 위치는 바꾸지 않고 조회할 때만 고른다.
 *
 * <p>정확도 30m를 넘는 위치는 빼고, 폰 위치는 ±15초 안에 쓸 수 있는 워치 위치가 없을 때만 쓴다. 측정 시각 순으로 잇되 출처가 바뀌거나 60초를
 * 넘는 공백에서 조각을 나눈다. 개인화 변환기의 워치 우선 기준(±15초)과 같은 값이다. 좌표는 로그에 남기지 않는다.
 */
public final class RunningRouteSelector {

    static final BigDecimal MAX_ACCURACY_M = BigDecimal.valueOf(30);
    static final Duration WATCH_HOLD = Duration.ofSeconds(15);
    static final Duration PART_GAP = Duration.ofSeconds(60);
    static final String WATCH = "WATCH";

    private RunningRouteSelector() {}

    /** 저장된 위치 하나. source는 user_devices.device_type(없으면 PHONE). accuracy는 null 가능. */
    public record RoutePoint(
            Instant measuredAt, double longitude, double latitude, BigDecimal accuracy, String source) {

        boolean usable() {
            return accuracy == null || accuracy.compareTo(MAX_ACCURACY_M) <= 0;
        }

        boolean watch() {
            return WATCH.equals(source);
        }
    }

    /** 한 출처의 이어진 조각. coordinates는 [경도, 위도]. */
    public record Segment(String source, List<double[]> coordinates) {}

    /** points는 측정 시각 순이 아니어도 된다. 결과 위치 수가 maxPoints를 넘으면 조각 양 끝을 남기고 줄인다. */
    public static List<Segment> select(List<RoutePoint> points, int maxPoints) {
        List<RoutePoint> watch = points.stream().filter(p -> p.watch() && p.usable()).toList();
        List<Instant> watchTimes = watch.stream().map(RoutePoint::measuredAt).sorted().toList();
        List<RoutePoint> chosen = new ArrayList<>(watch);
        for (RoutePoint p : points) {
            if (!p.watch() && p.usable() && !nearWatch(watchTimes, p.measuredAt())) {
                chosen.add(p);
            }
        }
        chosen.sort(Comparator.comparing(RoutePoint::measuredAt));

        List<List<RoutePoint>> parts = new ArrayList<>();
        for (RoutePoint p : chosen) {
            List<RoutePoint> part = parts.isEmpty() ? null : parts.get(parts.size() - 1);
            RoutePoint last = part == null ? null : part.get(part.size() - 1);
            if (last != null
                    && last.source().equals(p.source())
                    && Duration.between(last.measuredAt(), p.measuredAt()).compareTo(PART_GAP) <= 0) {
                if (!last.measuredAt().equals(p.measuredAt())) {
                    part.add(p);
                }
            } else {
                List<RoutePoint> next = new ArrayList<>();
                next.add(p);
                parts.add(next);
            }
        }

        int total = parts.stream().mapToInt(List::size).sum();
        List<Segment> segments = new ArrayList<>();
        for (List<RoutePoint> part : parts) {
            List<RoutePoint> kept = total > maxPoints ? thin(part, total, maxPoints) : part;
            segments.add(
                    new Segment(
                            part.get(0).source(),
                            kept.stream().map(p -> new double[] {p.longitude(), p.latitude()}).toList()));
        }
        return segments;
    }

    private static boolean nearWatch(List<Instant> sortedWatch, Instant at) {
        // at 이상인 첫 워치 시각(삽입 위치)을 찾고, 그 앞뒤 두 시각만 확인하면 가장 가까운 워치 위치다.
        int low = 0;
        int high = sortedWatch.size();
        while (low < high) {
            int mid = (low + high) >>> 1;
            if (sortedWatch.get(mid).isBefore(at)) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        for (int i = low - 1; i <= low; i++) {
            if (i >= 0
                    && i < sortedWatch.size()
                    && Duration.between(sortedWatch.get(i), at).abs().compareTo(WATCH_HOLD) <= 0) {
                return true;
            }
        }
        return false;
    }

    /** 이 조각에 상한을 위치 수 비율로 나눠 주고, 처음·끝을 남긴 채 균등 간격으로 고른다. */
    private static List<RoutePoint> thin(List<RoutePoint> part, int total, int maxPoints) {
        int quota = Math.max(2, (int) ((long) maxPoints * part.size() / total));
        if (part.size() <= quota) {
            return part;
        }
        List<RoutePoint> kept = new ArrayList<>(quota);
        double step = (part.size() - 1) / (double) (quota - 1);
        for (int i = 0; i < quota; i++) {
            kept.add(part.get((int) Math.round(i * step)));
        }
        return kept;
    }
}
