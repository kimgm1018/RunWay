package com.runway.backend.domain.session.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.service.RunningRouteSelector.RoutePoint;
import com.runway.backend.domain.session.service.RunningRouteSelector.Segment;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** S11 경로 선택 규칙(sessions.md S11, 통합 설계 9.7) — AC-8, AC-9. 합성 좌표만 쓴다. */
class RunningRouteSelectorTest {

    private static final Instant T0 = Instant.parse("2026-11-10T01:00:00Z");

    private static RoutePoint watch(long sec, double lng, Double accuracy) {
        return point("WATCH", sec, lng, accuracy);
    }

    private static RoutePoint phone(long sec, double lng, Double accuracy) {
        return point("PHONE", sec, lng, accuracy);
    }

    private static RoutePoint point(String source, long sec, double lng, Double accuracy) {
        return new RoutePoint(
                T0.plusSeconds(sec),
                lng,
                37.5,
                accuracy == null ? null : BigDecimal.valueOf(accuracy),
                source);
    }

    private static List<List<Double>> lngs(List<Segment> segments) {
        return segments.stream()
                .map(s -> s.coordinates().stream().map(c -> c[0]).toList())
                .toList();
    }

    @Test
    void 같은_구간은_워치_위치를_쓰고_워치가_없는_구간만_폰으로_채운다() {
        List<Segment> segments =
                RunningRouteSelector.select(
                        List.of(
                                watch(0, 127.000, 5.0),
                                phone(10, 127.900, 5.0),
                                watch(20, 127.001, 5.0),
                                phone(40, 127.002, 5.0),
                                phone(45, 127.003, 5.0)),
                        2000);
        assertThat(segments).extracting(Segment::source).containsExactly("WATCH", "PHONE");
        assertThat(lngs(segments))
                .containsExactly(List.of(127.000, 127.001), List.of(127.002, 127.003));
    }

    @Test
    void 정확도_30m를_넘는_위치는_빼고_정확도가_없는_위치는_쓴다() {
        List<Segment> segments =
                RunningRouteSelector.select(
                        List.of(
                                watch(0, 127.000, 30.0),
                                watch(5, 127.001, 40.0),
                                watch(10, 127.002, null)),
                        2000);
        assertThat(lngs(segments)).containsExactly(List.of(127.000, 127.002));
    }

    @Test
    void 정확도가_나쁜_워치_위치는_폰_보완을_막지_않는다() {
        List<Segment> segments =
                RunningRouteSelector.select(
                        List.of(watch(0, 127.000, 80.0), phone(1, 127.500, 5.0)), 2000);
        assertThat(segments).extracting(Segment::source).containsExactly("PHONE");
    }

    @Test
    void 출처_전환과_60초를_넘는_공백에서_조각을_나눈다() {
        List<Segment> segments =
                RunningRouteSelector.select(
                        List.of(
                                watch(0, 127.000, 5.0),
                                watch(60, 127.001, 5.0),
                                watch(121, 127.002, 5.0),
                                phone(200, 127.003, 5.0)),
                        2000);
        assertThat(lngs(segments))
                .containsExactly(List.of(127.000, 127.001), List.of(127.002), List.of(127.003));
    }

    @Test
    void 같은_출처_같은_시각은_한_번만_쓴다() {
        List<Segment> segments =
                RunningRouteSelector.select(
                        List.of(watch(0, 127.000, 5.0), watch(0, 127.111, 5.0)), 2000);
        assertThat(lngs(segments)).containsExactly(List.of(127.000));
    }

    @Test
    void 상한을_넘으면_조각의_양_끝을_남기고_줄인다() {
        List<RoutePoint> points = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            points.add(watch(i, 127.0 + i / 1000.0, 5.0));
        }
        List<Segment> segments = RunningRouteSelector.select(points, 10);
        List<double[]> coords = segments.get(0).coordinates();
        assertThat(coords).hasSizeLessThanOrEqualTo(10);
        assertThat(coords.get(0)[0]).isEqualTo(127.0);
        assertThat(coords.get(coords.size() - 1)[0]).isEqualTo(127.099);
    }

    @Test
    void 위치가_없으면_빈_경로다() {
        assertThat(RunningRouteSelector.select(List.of(), 2000)).isEmpty();
    }
}
