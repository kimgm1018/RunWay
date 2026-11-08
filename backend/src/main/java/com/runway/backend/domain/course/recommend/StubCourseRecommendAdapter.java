package com.runway.backend.domain.course.recommend;

import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * 개발용 가짜 추천. {@code runway.course.route.mode=stub}을 명시했을 때만 주입한다(운영 기본은 Route HTTP).
 * 같은 입력+seed면 같은 경로. nextSeed = seed + 24. 실제 추천으로 오인하지 않도록 안내 문구를 넣는다.
 */
public class StubCourseRecommendAdapter implements CourseRecommendPort {

    public static final String NOTICE = "개발용 가짜 경로입니다. 실제 추천 결과가 아닙니다.";

    private static final int CANDIDATE_COUNT = 3;
    private static final int SEED_STEP = 24;
    /** 대략 1도 위도 ≈ 111km. */
    private static final double METERS_PER_DEG_LAT = 111_320d;

    @Override
    public GeneratedCourses recommend(CourseRecommendCommand command, Instant deadline) {
        List<GeneratedCourseCandidate> courses = new ArrayList<>(CANDIDATE_COUNT);
        for (int i = 0; i < CANDIDATE_COUNT; i++) {
            courses.add(
                    new GeneratedCourseCandidate(
                            i,
                            BigDecimal.valueOf(command.distanceKm() * 1000d)
                                    .setScale(2, RoundingMode.HALF_UP),
                            buildRoute(command, i),
                            NOTICE,
                            List.of(),
                            List.of(),
                            0d,
                            List.of()));
        }
        return new GeneratedCourses(courses, List.of(NOTICE), command.seed() + SEED_STEP);
    }

    private static GeoJsonLineString buildRoute(CourseRecommendCommand command, int index) {
        double lat = command.latitude();
        double lon = command.longitude();
        double radiusM = (command.distanceKm() * 1000d) / (2d * Math.PI);
        // seed·index로 시작 각도를 바꿔 후보를 다르게 보이게 한다.
        double startAngle = ((command.seed() * 17) + (index * 40)) % 360;
        int points = 12;
        List<List<Double>> coords = new ArrayList<>(points + 1);
        for (int p = 0; p < points; p++) {
            double angleDeg = startAngle + (360d * p / points);
            double rad = Math.toRadians(angleDeg);
            double dLat = (radiusM * Math.cos(rad)) / METERS_PER_DEG_LAT;
            double dLon =
                    (radiusM * Math.sin(rad))
                            / (METERS_PER_DEG_LAT * Math.cos(Math.toRadians(lat)));
            // GeoJSON: [lon, lat]
            coords.add(List.of(lon + dLon, lat + dLat));
        }
        coords.add(coords.get(0));
        if (command.shape() == CourseRecommendShape.POINT_TO_POINT
                && command.endLatitude() != null
                && command.endLongitude() != null) {
            // 편도: 출발 → 중간점(루프 한 점) → 도착
            List<List<Double>> p2p =
                    List.of(
                            List.of(lon, lat),
                            coords.get(Math.min(3, coords.size() - 1)),
                            List.of(command.endLongitude(), command.endLatitude()));
            return GeoJsonLineString.of(p2p);
        }
        if (command.shape() == CourseRecommendShape.OUT_AND_BACK) {
            List<Double> turn = coords.get(Math.min(4, coords.size() - 1));
            return GeoJsonLineString.of(List.of(List.of(lon, lat), turn, List.of(lon, lat)));
        }
        return GeoJsonLineString.of(coords);
    }
}
