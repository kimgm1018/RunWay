package com.runway.backend.infrastructure.route;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 계약을 만족하는 합성 Route 성공 응답. 출발점을 지나는 원형(순환) 경로를 만들어 길이가 distance_m과 맞게 한다. 실제 GPS 자료가
 * 아니다.
 */
public final class RouteFixtures {

    public static final double START_LAT = 35.1796;
    public static final double START_LON = 129.0756;
    private static final double METERS_PER_DEG_LAT = 111_320d;

    private RouteFixtures() {}

    /** 출발점에서 시작해 돌아오는 점 수 points+1의 [lat, lon] 원. startAngleDeg로 후보를 구분한다. */
    public static List<List<Double>> loop(
            double startLat, double startLon, double lengthM, int points, double startAngleDeg) {
        double radius = lengthM / (2 * Math.PI);
        double theta0 = Math.toRadians(startAngleDeg);
        double centerLat = startLat - radius * Math.cos(theta0) / METERS_PER_DEG_LAT;
        double lonScale = METERS_PER_DEG_LAT * Math.cos(Math.toRadians(startLat));
        double centerLon = startLon - radius * Math.sin(theta0) / lonScale;
        List<List<Double>> coords = new ArrayList<>();
        coords.add(List.of(startLat, startLon));
        for (int i = 1; i < points; i++) {
            double theta = theta0 + 2 * Math.PI * i / points;
            coords.add(
                    List.of(
                            centerLat + radius * Math.cos(theta) / METERS_PER_DEG_LAT,
                            centerLon + radius * Math.sin(theta) / lonScale));
        }
        coords.add(List.of(startLat, startLon));
        return coords;
    }

    public static Map<String, Object> route(int rank, List<List<Double>> coords, double distanceM) {
        Map<String, Object> scoreTerm = new LinkedHashMap<>();
        scoreTerm.put("term", "distance_fit");
        scoreTerm.put("label", "목표 거리 적합도");
        scoreTerm.put("group", "base");
        scoreTerm.put("feature_value", 0.96);
        scoreTerm.put("weight", 1.0);
        scoreTerm.put("contribution", 0.96);
        Map<String, Object> route = new LinkedHashMap<>();
        route.put("rank", rank);
        route.put("coords", new ArrayList<>(coords));
        route.put("distance_m", distanceM);
        route.put("summary", "강변을 많이 지나는 코스예요.");
        route.put("reasons", new ArrayList<>(List.of("강변 구간이 40%예요")));
        route.put("caveats", new ArrayList<>(List.of("계단이 1곳 있어요")));
        route.put("score", 0.96);
        route.put("score_terms", new ArrayList<>(List.of(scoreTerm)));
        return route;
    }

    /** 5km 순환 후보 count개, seed 1 기준 next_seed 25. */
    public static Map<String, Object> success(double startLat, double startLon, int count, int seed) {
        List<Object> routes = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            routes.add(route(i + 1, loop(startLat, startLon, 5000, 60, i * 90d), 5000.0));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("routes", routes);
        body.put("notices", new ArrayList<>(List.of("이 주변은 공원 정보가 일부만 있어요")));
        body.put("next_seed", seed + 24);
        return body;
    }

    public static Map<String, Object> success(int count) {
        return success(START_LAT, START_LON, count, 1);
    }
}
