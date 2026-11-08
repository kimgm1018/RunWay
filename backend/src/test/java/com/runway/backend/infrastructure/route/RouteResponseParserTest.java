package com.runway.backend.infrastructure.route;

import static com.runway.backend.infrastructure.route.RouteFixtures.START_LAT;
import static com.runway.backend.infrastructure.route.RouteFixtures.START_LON;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendFilters;
import com.runway.backend.domain.course.recommend.CourseRecommendShape;
import com.runway.backend.domain.course.recommend.GeneratedCourses;
import com.runway.backend.infrastructure.route.RouteResponseParser.InvalidRouteResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.json.JsonMapper;

/** AC-5: 검사마다 그 검사가 거절하는지(사유)와, 상한 바로 안쪽 값은 받는지를 확인한다. */
class RouteResponseParserTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final RouteResponseParser parser = new RouteResponseParser(JSON);

    private static final CourseRecommendCommand LOOP =
            new CourseRecommendCommand(
                    START_LAT, START_LON, 5.0, CourseRecommendShape.LOOP, null, null,
                    CourseRecommendFilters.allOff(), 1);

    private GeneratedCourses parse(Map<String, Object> body) {
        return parser.parse(JSON.writeValueAsString(body).getBytes(StandardCharsets.UTF_8), LOOP);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> first(Map<String, Object> body) {
        return (Map<String, Object>) ((List<Object>) body.get("routes")).getFirst();
    }

    @SuppressWarnings("unchecked")
    private static List<List<Double>> coords(Map<String, Object> route) {
        return (List<List<Double>>) route.get("coords");
    }

    private static Arguments rejected(String reason, Consumer<Map<String, Object>> mutation) {
        return Arguments.of(reason, mutation);
    }

    @SuppressWarnings("unchecked")
    static Stream<Arguments> rejections() {
        // 출발점(35.1796,129.0756)에서 100m 이내라 스냅 검사는 통과하는 위치의 축 바뀜·범위 오류를 만든다.
        return Stream.of(
                rejected("후보 수", body -> body.put("routes", List.of())),
                rejected("rank 순서", body -> first(body).put("rank", 2)),
                rejected("rank 형식", body -> first(body).put("rank", 1.5)),
                rejected("coords 점 수", body -> first(body).put("coords", RouteFixtures.loop(START_LAT, START_LON, 5000, 3000, 0))),
                rejected("coords 차원", body -> coords(first(body)).set(3, List.of(35.18, 129.07, 3.0))),
                rejected("coords 범위", body -> coords(first(body)).set(3, List.of(95.0, 129.07))),
                rejected("lat 유한수 아님", body -> ((List<Object>) first(body).get("coords")).set(3, List.<Object>of(new java.math.BigDecimal("1e400"), 129.07))),
                rejected("lat 형식", body -> ((List<Object>) first(body).get("coords")).set(3, List.<Object>of("35.18", 129.07))),
                rejected("목표 거리 범위", body -> {
                    first(body).put("coords", RouteFixtures.loop(START_LAT, START_LON, 5510, 60, 0));
                    first(body).put("distance_m", 5510.0);
                }),
                rejected("좌표 길이 불일치", body -> first(body).put("distance_m", 4700.0)),
                rejected("distance_m 양수 아님", body -> first(body).put("distance_m", 0)),
                rejected("출발 스냅 거리", body -> first(body).put("coords", RouteFixtures.loop(START_LAT + 0.0023, START_LON, 5000, 60, 0))),
                rejected("폐곡선 아님", body -> coords(first(body)).set(coords(first(body)).size() - 1, List.of(START_LAT + 0.00002, START_LON))),
                rejected("중복 후보", body -> {
                    var copy = new LinkedHashMap<>(first(body));
                    copy.put("rank", 2);
                    ((List<Object>) body.get("routes")).add(copy);
                }),
                rejected("summary 길이", body -> first(body).put("summary", "가".repeat(101))),
                rejected("summary 형식", body -> first(body).put("summary", 3)),
                rejected("reasons 개수", body -> first(body).put("reasons", IntStream.rangeClosed(1, 21).mapToObj(String::valueOf).toList())),
                rejected("caveats 개수", body -> first(body).put("caveats", IntStream.rangeClosed(1, 21).mapToObj(String::valueOf).toList())),
                rejected("notices 개수", body -> body.put("notices", IntStream.rangeClosed(1, 21).mapToObj(String::valueOf).toList())),
                rejected("reasons 형식", body -> first(body).put("reasons", List.of(1))),
                rejected("caveats 길이", body -> first(body).put("caveats", List.of("가".repeat(101)))),
                rejected("notices 없음", body -> body.remove("notices")),
                rejected("score_terms 개수", body -> {
                    var term = ((List<Object>) first(body).get("score_terms")).getFirst();
                    var terms = new ArrayList<Object>();
                    for (int i = 0; i < 21; i++) terms.add(term);
                    first(body).put("score_terms", terms);
                }),
                rejected("weight 형식", body -> ((Map<String, Object>) ((List<Object>) first(body).get("score_terms")).getFirst()).put("weight", "1")),
                rejected("next_seed", body -> body.put("next_seed", 26)));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void 계약위반은_해당_검사가_거절한다(String reason, Consumer<Map<String, Object>> mutation) {
        var body = RouteFixtures.success(1);
        mutation.accept(body);

        assertThatThrownBy(() -> parse(body))
                .isInstanceOf(InvalidRouteResponse.class)
                .hasMessage(reason);
    }

    @Test
    @SuppressWarnings("unchecked")
    void 상한_바로_안쪽_값은_받는다() {
        var body = RouteFixtures.success(3);
        var route = first(body);
        // 3,000점 순환(첫 점=끝 점), 목표 대비 +9.8%이고 좌표 길이와 맞는 거리.
        route.put("coords", RouteFixtures.loop(START_LAT, START_LON, 5490, 2999, 0));
        route.put("distance_m", 5490.0);
        route.put("summary", "가".repeat(100));
        route.put("reasons", Stream.concat(IntStream.rangeClosed(1, 19).mapToObj(String::valueOf), Stream.of("가".repeat(100))).toList());
        // 현행 Route 최악 caveats 12개(explain.py, 환경 필터 5종)를 넉넉히 포함하는 상한 20개.
        route.put("caveats", IntStream.rangeClosed(1, 20).mapToObj(String::valueOf).toList());
        var term = ((List<Object>) route.get("score_terms")).getFirst();
        var terms = new ArrayList<Object>();
        for (int i = 0; i < 20; i++) terms.add(term);
        route.put("score_terms", terms);
        body.put("notices", IntStream.rangeClosed(1, 20).mapToObj(String::valueOf).toList());

        GeneratedCourses result = parse(body);

        assertThat(result.courses()).hasSize(3);
        assertThat(result.courses().getFirst().route().positionCount()).isEqualTo(3000);
        assertThat(result.courses().getFirst().reasons()).hasSize(20);
        assertThat(result.courses().getFirst().caveats()).hasSize(20);
        assertThat(result.courses().getFirst().scoreTerms()).hasSize(20);
        assertThat(result.notices()).hasSize(20);
    }

    @Test
    void 빈_문구는_그_항목만_빼고_받는다() {
        var body = RouteFixtures.success(1);
        first(body).put("reasons", List.of("", "강변 구간이 40%예요", "  "));
        first(body).put("caveats", List.of(""));
        body.put("notices", List.of(" ", "공원 정보가 일부만 있어요"));

        GeneratedCourses result = parse(body);

        assertThat(result.courses().getFirst().reasons()).containsExactly("강변 구간이 40%예요");
        assertThat(result.courses().getFirst().caveats()).isEmpty();
        assertThat(result.notices()).containsExactly("공원 정보가 일부만 있어요");
    }

    @Test
    void 편도는_도착점_스냅을_보고_폐곡선을_요구하지_않는다() {
        double endLat = START_LAT + 0.02;
        var line = new ArrayList<List<Double>>();
        for (int i = 0; i <= 20; i++) line.add(List.of(START_LAT + 0.02 * i / 20, START_LON));
        double lengthM = RouteResponseParser.haversine(START_LAT, START_LON, endLat, START_LON);
        var body = RouteFixtures.success(1);
        body.put("routes", new ArrayList<>(List.of(RouteFixtures.route(1, line, lengthM))));
        var p2p =
                new CourseRecommendCommand(
                        START_LAT, START_LON, lengthM / 1000, CourseRecommendShape.POINT_TO_POINT,
                        endLat, START_LON, CourseRecommendFilters.allOff(), 1);
        byte[] raw = JSON.writeValueAsString(body).getBytes(StandardCharsets.UTF_8);

        assertThat(parser.parse(raw, p2p).courses()).hasSize(1);

        var farEnd =
                new CourseRecommendCommand(
                        START_LAT, START_LON, lengthM / 1000, CourseRecommendShape.POINT_TO_POINT,
                        endLat + 0.003, START_LON, CourseRecommendFilters.allOff(), 1);
        assertThatThrownBy(() -> parser.parse(raw, farEnd)).hasMessage("도착 스냅 거리");
    }
}
