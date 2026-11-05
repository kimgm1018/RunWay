package com.runway.backend.infrastructure.route;

import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendShape;
import com.runway.backend.domain.course.recommend.GeneratedCourseCandidate;
import com.runway.backend.domain.course.recommend.GeneratedCourseCandidate.ScoreTerm;
import com.runway.backend.domain.course.recommend.GeneratedCourses;
import com.runway.backend.global.geo.GeoJsonLineString;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Route 200 응답을 검증해 내부 후보로 바꾼다(ai-service.md "Route 성공 응답과 좌표 변환"). 한 항목이라도 계약과 다르면 일부만
 * 버리지 않고 전체를 {@link InvalidRouteResponse}로 거절한다. 원본 문구·좌표를 예외 메시지에 넣지 않는다.
 */
final class RouteResponseParser {

    static final int MAX_CANDIDATES = 3;
    static final int MAX_COORDINATES = 3_000;
    static final int MAX_SUMMARY_LENGTH = 100;
    /**
     * reasons·caveats·notices 각 개수 상한. 문구 개수 초과로 정상 후보 전체를 503으로 버리지 않도록 현행 Route 최악값(caveats
     * 12개, notices 9개, reasons 4개)보다 넉넉하게 잡은 방어 상한이다. 잘라서 받지 않는다(경고 문구 누락 방지).
     */
    static final int MAX_TEXTS = 20;
    static final int MAX_TEXT_LENGTH = 100;
    static final int MAX_SCORE_TERMS = 20;
    static final int SEED_STEP = 24;

    /** Route 현행 유효성 기준: 목표 거리 대비 ±10%. */
    static final double TARGET_DISTANCE_TOLERANCE = 0.10;

    /** 좌표 길이와 distance_m의 허용 차이(S15P31E105-423 D-6, ±5%). */
    static final double PATH_LENGTH_TOLERANCE = 0.05;

    /** 스냅 허용 이동(Route 현행 최대 250m). */
    static final double MAX_SNAP_M = 250;

    /** 순환·왕복의 첫/끝 좌표 일치 허용 오차(m). 같은 노드로 돌아오면 0이다. */
    static final double MAX_CLOSURE_M = 1;

    private static final double EARTH_RADIUS_M = 6_371_008.8;

    private final JsonMapper jsonMapper;

    RouteResponseParser(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    GeneratedCourses parse(byte[] body, CourseRecommendCommand command) {
        JsonNode root;
        try {
            root = jsonMapper.readTree(body);
        } catch (RuntimeException ex) {
            throw new InvalidRouteResponse("본문 파싱 실패");
        }
        if (root == null || !root.isObject()) throw new InvalidRouteResponse("객체 아님");

        JsonNode routes = root.get("routes");
        if (routes == null || !routes.isArray()) throw new InvalidRouteResponse("routes 없음");
        if (routes.isEmpty() || routes.size() > MAX_CANDIDATES) {
            throw new InvalidRouteResponse("후보 수");
        }

        double targetM = command.distanceKm() * 1000d;
        List<GeneratedCourseCandidate> candidates = new ArrayList<>(routes.size());
        Set<List<List<Double>>> seen = new HashSet<>();
        for (int i = 0; i < routes.size(); i++) {
            JsonNode route = routes.get(i);
            if (route == null || !route.isObject()) throw new InvalidRouteResponse("후보 형식");
            int rank = requireInt(route.get("rank"), "rank");
            if (rank != i + 1) throw new InvalidRouteResponse("rank 순서");

            List<List<Double>> latLon = coordinates(route.get("coords"));
            double distanceM = requirePositiveFinite(route.get("distance_m"), "distance_m");
            if (Math.abs(distanceM - targetM) > targetM * TARGET_DISTANCE_TOLERANCE) {
                throw new InvalidRouteResponse("목표 거리 범위");
            }
            double pathM = pathLength(latLon);
            if (Math.abs(pathM - distanceM) > distanceM * PATH_LENGTH_TOLERANCE) {
                throw new InvalidRouteResponse("좌표 길이 불일치");
            }
            checkEndpoints(latLon, command);
            if (!seen.add(latLon)) throw new InvalidRouteResponse("중복 후보");

            candidates.add(
                    new GeneratedCourseCandidate(
                            i,
                            BigDecimal.valueOf(distanceM).setScale(2, RoundingMode.HALF_UP),
                            toGeoJson(latLon),
                            requireText(route.get("summary"), MAX_SUMMARY_LENGTH, "summary"),
                            texts(route.get("reasons"), "reasons"),
                            texts(route.get("caveats"), "caveats"),
                            requireFinite(route.get("score"), "score"),
                            scoreTerms(route.get("score_terms"))));
        }

        List<String> notices = texts(root.get("notices"), "notices");
        int nextSeed = requireInt(root.get("next_seed"), "next_seed");
        if ((long) nextSeed != (long) command.seed() + SEED_STEP) {
            throw new InvalidRouteResponse("next_seed");
        }
        return new GeneratedCourses(candidates, notices, nextSeed);
    }

    /** Route [lat, lon] 2D 좌표열. 축 범위·유한수·점 수를 검사한다. */
    private static List<List<Double>> coordinates(JsonNode coords) {
        if (coords == null || !coords.isArray()) throw new InvalidRouteResponse("coords 없음");
        if (coords.size() < 2 || coords.size() > MAX_COORDINATES) {
            throw new InvalidRouteResponse("coords 점 수");
        }
        List<List<Double>> points = new ArrayList<>(coords.size());
        for (JsonNode point : coords) {
            if (point == null || !point.isArray() || point.size() != 2) {
                throw new InvalidRouteResponse("coords 차원");
            }
            double lat = requireFinite(point.get(0), "lat");
            double lon = requireFinite(point.get(1), "lon");
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                throw new InvalidRouteResponse("coords 범위");
            }
            points.add(List.of(lat, lon));
        }
        return points;
    }

    private static void checkEndpoints(List<List<Double>> latLon, CourseRecommendCommand command) {
        List<Double> first = latLon.getFirst();
        List<Double> last = latLon.getLast();
        if (haversine(first.get(0), first.get(1), command.latitude(), command.longitude())
                > MAX_SNAP_M) {
            throw new InvalidRouteResponse("출발 스냅 거리");
        }
        if (command.shape() == CourseRecommendShape.POINT_TO_POINT) {
            if (haversine(last.get(0), last.get(1), command.endLatitude(), command.endLongitude())
                    > MAX_SNAP_M) {
                throw new InvalidRouteResponse("도착 스냅 거리");
            }
        } else if (haversine(first.get(0), first.get(1), last.get(0), last.get(1))
                > MAX_CLOSURE_M) {
            throw new InvalidRouteResponse("폐곡선 아님");
        }
    }

    /** [lat, lon]을 GeoJSON [lon, lat]으로 한 번만 교환한다. 점 순서·방향은 그대로다. */
    private static GeoJsonLineString toGeoJson(List<List<Double>> latLon) {
        List<List<Double>> lonLat = new ArrayList<>(latLon.size());
        for (List<Double> point : latLon) {
            lonLat.add(List.of(point.get(1), point.get(0)));
        }
        return GeoJsonLineString.of(lonLat);
    }

    private static List<ScoreTerm> scoreTerms(JsonNode node) {
        if (node == null || !node.isArray()) throw new InvalidRouteResponse("score_terms 없음");
        if (node.size() > MAX_SCORE_TERMS) throw new InvalidRouteResponse("score_terms 개수");
        List<ScoreTerm> terms = new ArrayList<>(node.size());
        for (JsonNode term : node) {
            if (term == null || !term.isObject()) throw new InvalidRouteResponse("score_terms 형식");
            // term·group은 열린 집합이라 값 목록을 검사하지 않는다.
            terms.add(
                    new ScoreTerm(
                            requireText(term.get("term"), MAX_TEXT_LENGTH, "term"),
                            requireText(term.get("label"), MAX_TEXT_LENGTH, "label"),
                            requireText(term.get("group"), MAX_TEXT_LENGTH, "group"),
                            requireFinite(term.get("feature_value"), "feature_value"),
                            requireFinite(term.get("weight"), "weight"),
                            requireFinite(term.get("contribution"), "contribution")));
        }
        return terms;
    }

    /**
     * 문구 목록. 빈 문자열(공백뿐 포함)은 표시할 내용이 없으므로 그 항목만 뺀다(S15P31E105-423 리뷰 결정). 문자열이 아닌 값·길이
     * 초과·개수 초과는 계약 위반이다. 개수 상한은 받은 배열 기준이다.
     */
    private static List<String> texts(JsonNode node, String field) {
        if (node == null || !node.isArray()) throw new InvalidRouteResponse(field + " 없음");
        if (node.size() > MAX_TEXTS) throw new InvalidRouteResponse(field + " 개수");
        List<String> values = new ArrayList<>(node.size());
        for (JsonNode text : node) {
            if (text == null || !text.isString()) throw new InvalidRouteResponse(field + " 형식");
            if (text.stringValue().isBlank()) continue;
            values.add(requireText(text, MAX_TEXT_LENGTH, field));
        }
        return values;
    }

    private static String requireText(JsonNode node, int maxLength, String field) {
        if (node == null || !node.isString()) throw new InvalidRouteResponse(field + " 형식");
        String value = node.stringValue();
        if (value.isBlank() || value.codePointCount(0, value.length()) > maxLength) {
            throw new InvalidRouteResponse(field + " 길이");
        }
        return value;
    }

    private static int requireInt(JsonNode node, String field) {
        if (node == null || !node.isIntegralNumber() || !node.canConvertToInt()) {
            throw new InvalidRouteResponse(field + " 형식");
        }
        return node.intValue();
    }

    private static double requireFinite(JsonNode node, String field) {
        if (node == null || !node.isNumber()) throw new InvalidRouteResponse(field + " 형식");
        double value = node.doubleValue();
        if (!Double.isFinite(value)) throw new InvalidRouteResponse(field + " 유한수 아님");
        return value;
    }

    private static double requirePositiveFinite(JsonNode node, String field) {
        double value = requireFinite(node, field);
        if (value <= 0) throw new InvalidRouteResponse(field + " 양수 아님");
        return value;
    }

    private static double pathLength(List<List<Double>> latLon) {
        double total = 0;
        for (int i = 1; i < latLon.size(); i++) {
            List<Double> a = latLon.get(i - 1);
            List<Double> b = latLon.get(i);
            total += haversine(a.get(0), a.get(1), b.get(0), b.get(1));
        }
        return total;
    }

    static double haversine(double lat1, double lon1, double lat2, double lon2) {
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double sinLat = Math.sin((phi2 - phi1) / 2);
        double sinLon = Math.sin(Math.toRadians(lon2 - lon1) / 2);
        double h = sinLat * sinLat + Math.cos(phi1) * Math.cos(phi2) * sinLon * sinLon;
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.clamp(h, 0, 1)));
    }

    /** 계약 위반 사유. 사유 문자열은 테스트·내부 진단용이며 공개 응답·로그에 좌표를 넣지 않는다. */
    static final class InvalidRouteResponse extends RuntimeException {
        InvalidRouteResponse(String reason) {
            super(reason, null, false, false);
        }
    }
}
