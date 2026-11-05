package com.runway.backend.infrastructure.route;

import static com.runway.backend.infrastructure.route.RouteFixtures.START_LAT;
import static com.runway.backend.infrastructure.route.RouteFixtures.START_LON;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendFilters;
import com.runway.backend.domain.course.recommend.CourseRecommendShape;
import com.runway.backend.domain.course.recommend.GeneratedCourseCandidate;
import com.runway.backend.domain.course.recommend.GeneratedCourses;
import com.runway.backend.global.exception.ApiException;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** AC-1·2·5·6·8: Route HTTP 요청 형식, 응답 변환·검증, 오류 매핑, 시간 상한. */
class RouteHttpCourseRecommendAdapterTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final FakeRouteServer SERVER = new FakeRouteServer();
    private static final Clock CLOCK = Clock.systemUTC();

    private final RouteHttpCourseRecommendAdapter adapter =
            adapter(SERVER.baseUri(), Duration.ofSeconds(15));

    @AfterAll
    static void stopServer() {
        SERVER.close();
    }

    @BeforeEach
    void resetServer() {
        SERVER.reset();
    }

    private static RouteHttpCourseRecommendAdapter adapter(URI base, Duration requestTimeout) {
        return new RouteHttpCourseRecommendAdapter(
                base, Duration.ofSeconds(1), requestTimeout, JSON, CLOCK);
    }

    private static CourseRecommendCommand loop(CourseRecommendFilters filters) {
        return new CourseRecommendCommand(
                START_LAT, START_LON, 5.0, CourseRecommendShape.LOOP, null, null, filters, 1);
    }

    private static Instant farDeadline() {
        return Instant.now().plusSeconds(60);
    }

    private static String json(Object value) {
        return JSON.writeValueAsString(value);
    }

    private static ApiException failureOf(Runnable call) {
        try {
            call.run();
        } catch (ApiException ex) {
            return ex;
        }
        throw new AssertionError("ApiException이 발생해야 합니다.");
    }

    @Test
    void 필터와_입력_정규화값만_snake_case로_보내고_인증정보는_보내지않는다() {
        SERVER.respond(200, json(RouteFixtures.success(1)));
        var filters =
                new CourseRecommendFilters(true, false, false, false, false, false, false, false, false);

        adapter.recommend(loop(filters), farDeadline());

        assertThat(SERVER.received()).hasSize(1);
        var request = SERVER.received().getFirst();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/internal/v1/routes/recommendations");
        assertThat(request.headers()).doesNotContainKeys("authorization", "cookie", "x-user-id");
        JsonNode body = JSON.readTree(request.body());
        assertThat(body.propertyNames())
                .containsExactly("lat", "lon", "distance_km", "shape", "seed", "filters");
        assertThat(body.get("lat").doubleValue()).isEqualTo(START_LAT);
        assertThat(body.get("lon").doubleValue()).isEqualTo(START_LON);
        assertThat(body.get("distance_km").doubleValue()).isEqualTo(5.0);
        assertThat(body.get("shape").stringValue()).isEqualTo("loop");
        assertThat(body.get("seed").intValue()).isEqualTo(1);
        assertThat(body.get("filters").propertyNames())
                .containsExactly(
                        "river",
                        "beach",
                        "park",
                        "trail",
                        "pedestrian",
                        "avoid_major_road",
                        "avoid_steps",
                        "avoid_tunnel",
                        "flat");
        assertThat(body.get("filters").get("river").booleanValue()).isTrue();
        assertThat(body.get("filters").properties())
                .filteredOn(entry -> !entry.getKey().equals("river"))
                .allSatisfy(entry -> assertThat(entry.getValue().isBoolean() && !entry.getValue().booleanValue()).isTrue());
    }

    @Test
    void 계산_시작_마감을_우리_마감보다_6초_앞선_epoch_ms로_보낸다() {
        SERVER.respond(200, json(RouteFixtures.success(1)));
        // C01 전체 예산(10초 남음)이 Route 상한(15초)보다 먼저 끝나는 경우: 그 마감 기준.
        Instant overall = Instant.now().plusSeconds(10);

        adapter.recommend(loop(CourseRecommendFilters.allOff()), overall);

        assertThat(SERVER.received().getFirst().headers().get("x-request-deadline"))
                .containsExactly(Long.toString(overall.minusSeconds(6).toEpochMilli()));

        // Route 상한(15초)이 먼저인 경우: 호출 시각 + 15초 - 6초 근처.
        SERVER.reset();
        SERVER.respond(200, json(RouteFixtures.success(1)));
        long before = Instant.now().toEpochMilli();
        adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline());
        long after = Instant.now().toEpochMilli();
        long sent = Long.parseLong(SERVER.received().getFirst().headers().get("x-request-deadline").getFirst());
        assertThat(sent).isBetween(before + 9_000, after + 9_000);
    }

    @Test
    void 편도만_도착좌표를_보내고_순환의_도착좌표는_무시한다() {
        double endLat = START_LAT + 0.02;
        double endLon = START_LON;
        var p2pRoute = new ArrayList<List<Double>>();
        // 출발→도착 직선(약 2.2km)을 따라가는 점열.
        for (int i = 0; i <= 20; i++) {
            p2pRoute.add(List.of(START_LAT + 0.02 * i / 20, START_LON));
        }
        double lengthM = RouteResponseParser.haversine(START_LAT, START_LON, endLat, endLon);
        var body = RouteFixtures.success(1);
        body.put("routes", new ArrayList<>(List.of(RouteFixtures.route(1, p2pRoute, lengthM))));
        SERVER.respond(200, json(body));
        var p2p =
                new CourseRecommendCommand(
                        START_LAT,
                        START_LON,
                        lengthM / 1000,
                        CourseRecommendShape.POINT_TO_POINT,
                        endLat,
                        endLon,
                        CourseRecommendFilters.allOff(),
                        1);

        GeneratedCourses result = adapter.recommend(p2p, farDeadline());

        JsonNode sent = JSON.readTree(SERVER.received().getFirst().body());
        assertThat(sent.get("shape").stringValue()).isEqualTo("point_to_point");
        assertThat(sent.get("end_lat").doubleValue()).isEqualTo(endLat);
        assertThat(sent.get("end_lon").doubleValue()).isEqualTo(endLon);
        assertThat(result.courses().getFirst().route().coordinates().getLast())
                .containsExactly(endLon, endLat);

        SERVER.reset();
        SERVER.respond(200, json(RouteFixtures.success(1)));
        var loopWithEnd =
                new CourseRecommendCommand(
                        START_LAT,
                        START_LON,
                        5.0,
                        CourseRecommendShape.LOOP,
                        endLat,
                        endLon,
                        CourseRecommendFilters.allOff(),
                        1);
        adapter.recommend(loopWithEnd, farDeadline());
        JsonNode loopSent = JSON.readTree(SERVER.received().getFirst().body());
        assertThat(loopSent.has("end_lat")).isFalse();
        assertThat(loopSent.has("end_lon")).isFalse();
    }

    @Test
    void 성공응답의_후보를_좌표교환과_설명점수_원문으로_변환한다() {
        var body = RouteFixtures.success(2);
        @SuppressWarnings("unchecked")
        var first = (Map<String, Object>) ((List<Object>) body.get("routes")).getFirst();
        first.put("distance_m", 5012.345);
        SERVER.respond(200, json(body));

        GeneratedCourses result =
                adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline());

        assertThat(result.courses()).hasSize(2);
        assertThat(result.courses()).extracting(GeneratedCourseCandidate::index).containsExactly(0, 1);
        GeneratedCourseCandidate candidate = result.courses().getFirst();
        // Route [lat, lon] → GeoJSON [lon, lat]. 첫 점은 출발점이며 점 순서와 수를 보존한다.
        assertThat(candidate.route().coordinates().getFirst()).containsExactly(START_LON, START_LAT);
        @SuppressWarnings("unchecked")
        var coords = (List<List<Double>>) first.get("coords");
        assertThat(candidate.route().positionCount()).isEqualTo(coords.size());
        assertThat(candidate.route().coordinates().get(5))
                .containsExactly(coords.get(5).get(1), coords.get(5).get(0));
        assertThat(candidate.distanceM()).hasToString("5012.35");
        assertThat(candidate.summary()).isEqualTo("강변을 많이 지나는 코스예요.");
        assertThat(candidate.reasons()).containsExactly("강변 구간이 40%예요");
        assertThat(candidate.caveats()).containsExactly("계단이 1곳 있어요");
        assertThat(candidate.score()).isEqualTo(0.96);
        assertThat(candidate.scoreTerms())
                .singleElement()
                .satisfies(
                        term -> {
                            assertThat(term.term()).isEqualTo("distance_fit");
                            assertThat(term.label()).isEqualTo("목표 거리 적합도");
                            assertThat(term.group()).isEqualTo("base");
                            assertThat(term.featureValue()).isEqualTo(0.96);
                            assertThat(term.weight()).isEqualTo(1.0);
                            assertThat(term.contribution()).isEqualTo(0.96);
                        });
        assertThat(result.notices()).containsExactly("이 주변은 공원 정보가 일부만 있어요");
        assertThat(result.nextSeed()).isEqualTo(25);
    }

    @Test
    void 알수없는_점수항목과_빈_설명배열은_허용한다() {
        var body = RouteFixtures.success(1);
        var route = firstRoute(body);
        @SuppressWarnings("unchecked")
        var term = (Map<String, Object>) ((List<Object>) route.get("score_terms")).getFirst();
        term.put("term", "brand_new_term");
        term.put("group", "brand_new_group");
        route.put("reasons", List.of());
        route.put("caveats", List.of());
        body.put("notices", List.of());
        SERVER.respond(200, json(body));

        GeneratedCourses result =
                adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline());

        assertThat(result.courses().getFirst().scoreTerms().getFirst().term())
                .isEqualTo("brand_new_term");
        assertThat(result.notices()).isEmpty();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> firstRoute(Map<String, Object> body) {
        return (Map<String, Object>) ((List<Object>) body.get("routes")).getFirst();
    }

    @SuppressWarnings("unchecked")
    private static List<List<Double>> coords(Map<String, Object> route) {
        return (List<List<Double>>) route.get("coords");
    }

    @SuppressWarnings("unchecked")
    static Stream<Arguments> invalidResponses() {
        return Stream.<Arguments>of(
                invalid("후보 4개", body -> {
                    var many = RouteFixtures.success(3);
                    var routes = (List<Object>) many.get("routes");
                    routes.add(RouteFixtures.route(4, RouteFixtures.loop(START_LAT, START_LON, 5000, 60, 45), 5000.0));
                    body.put("routes", routes);
                }),
                invalid("후보 0개", body -> body.put("routes", List.of())),
                invalid("rank 누락", body -> firstRoute(body).remove("rank")),
                invalid("rank 0부터", body -> firstRoute(body).put("rank", 0)),
                invalid("좌표축 뒤바뀜", body -> {
                    var swapped = new ArrayList<List<Double>>();
                    for (var point : coords(firstRoute(body))) swapped.add(List.of(point.get(1), point.get(0)));
                    firstRoute(body).put("coords", swapped);
                }),
                invalid("3D 좌표", body -> {
                    var withZ = new ArrayList<List<Double>>();
                    for (var point : coords(firstRoute(body))) withZ.add(List.of(point.get(0), point.get(1), 12.0));
                    firstRoute(body).put("coords", withZ);
                }),
                invalid("좌표 문자열", body -> firstRoute(body).put("coords", List.of(List.of("35.1", "129.0"), List.of("35.2", "129.0")))),
                invalid("좌표 3001점", body -> firstRoute(body).put("coords", RouteFixtures.loop(START_LAT, START_LON, 5000, 3000, 0))),
                invalid("목표거리 10% 초과", body -> firstRoute(body).put("distance_m", 5600.0)),
                invalid("좌표길이와 distance_m 5% 초과 차이", body -> firstRoute(body).put("coords", RouteFixtures.loop(START_LAT, START_LON, 4400, 60, 0))),
                invalid("distance_m 음수", body -> firstRoute(body).put("distance_m", -5000.0)),
                invalid("순환인데 닫히지 않음", body -> {
                    var open = new ArrayList<>(coords(firstRoute(body)));
                    open.removeLast();
                    open.removeLast();
                    firstRoute(body).put("coords", open);
                }),
                invalid("출발점 250m 초과", body -> firstRoute(body).put("coords", RouteFixtures.loop(START_LAT + 0.003, START_LON, 5000, 60, 0))),
                invalid("summary 101자", body -> firstRoute(body).put("summary", "가".repeat(101))),
                invalid("summary 빈 값", body -> firstRoute(body).put("summary", " ")),
                invalid("reasons 21개", body -> firstRoute(body).put("reasons", IntStream.rangeClosed(1, 21).mapToObj(String::valueOf).toList())),
                invalid("caveats 문구 101자", body -> firstRoute(body).put("caveats", List.of("가".repeat(101)))),
                invalid("notices 누락", body -> body.remove("notices")),
                invalid("score 문자열", body -> firstRoute(body).put("score", "high")),
                invalid("score_terms 21개", body -> {
                    var terms = new ArrayList<Object>();
                    for (int i = 0; i < 21; i++) terms.add(((List<Object>) firstRoute(body).get("score_terms")).getFirst());
                    firstRoute(body).put("score_terms", terms);
                }),
                invalid("score_terms weight 누락", body -> ((Map<String, Object>) ((List<Object>) firstRoute(body).get("score_terms")).getFirst()).remove("weight")),
                invalid("next_seed 불일치", body -> body.put("next_seed", 2)),
                invalid("중복 후보", body -> {
                    var routes = (List<Object>) body.get("routes");
                    var copy = new java.util.LinkedHashMap<>(firstRoute(body));
                    copy.put("rank", 2);
                    routes.add(copy);
                }),
                invalid("HTTP 200 오류 본문", body -> {
                    body.clear();
                    body.put("ok", false);
                    body.put("code", "BUSY");
                }));
    }

    private static Arguments invalid(String name, Consumer<Map<String, Object>> mutation) {
        return Arguments.of(name, mutation);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidResponses")
    void 계약을_벗어난_성공응답은_일부를_버리지않고_전체를_INVALID_RESPONSE로_실패한다(
            String name, Consumer<Map<String, Object>> mutation) {
        var body = RouteFixtures.success(1);
        mutation.accept(body);
        SERVER.respond(200, json(body));

        ApiException failure =
                failureOf(() -> adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));

        assertThat(failure.status().value()).isEqualTo(503);
        assertThat(failure.code()).isEqualTo("SERVICE_UNAVAILABLE");
        assertThat(failure.details()).containsEntry("reason", "ROUTE_INVALID_RESPONSE");
    }

    @Test
    void JSON이_아닌_본문과_NaN_표기는_INVALID_RESPONSE다() {
        for (String raw : List.of("<html>bad gateway</html>", "{\"routes\": [{\"rank\": 1, \"score\": NaN}]}", "")) {
            SERVER.respond(200, raw);
            ApiException failure =
                    failureOf(() -> adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));
            assertThat(failure.details()).containsEntry("reason", "ROUTE_INVALID_RESPONSE");
        }
    }

    @ParameterizedTest(name = "{0} {1} → {2} {3}")
    @CsvSource({
        "422, OUT_OF_AREA, 422, OUT_OF_AREA",
        "422, OUT_OF_APP_RANGE, 422, OUT_OF_APP_RANGE",
        "422, NO_ROAD_NEARBY, 422, NO_ROAD_NEARBY",
        "422, DESTINATION_TOO_FAR, 422, DESTINATION_TOO_FAR",
        "422, END_SNAP_PE1, 422, NO_ROAD_NEARBY",
        "422, END_SNAP_PE2, 422, NO_ROAD_NEARBY",
        "422, END_SNAP_PE4, 422, NO_ROAD_NEARBY",
        "422, END_SNAP_PE5, 422, NO_ROAD_NEARBY",
        "422, NO_ROUTE, 422, NO_ROUTE",
        "422, USABILITY_GATE_ALL_FAILED, 422, NO_ROUTE",
        "503, NOT_READY, 503, ROUTE_NOT_READY",
        "503, BUSY, 503, ROUTE_BUSY",
        "503, TIMEOUT, 503, ROUTE_TIMEOUT",
        "503, UNAVAILABLE, 503, ROUTE_UNAVAILABLE",
        "500, INTERNAL, 503, ROUTE_UNAVAILABLE",
        "500, SAFETY_CHECK, 503, ROUTE_UNAVAILABLE",
        "500, SNAP_NODE_NOT_IN_GENERATION_GRAPH, 503, ROUTE_UNAVAILABLE",
        "422, END_SNAP_PE3, 503, ROUTE_INVALID_RESPONSE",
        "422, VALIDATION, 503, ROUTE_INVALID_RESPONSE",
        "422, DISTANCE_RANGE, 503, ROUTE_INVALID_RESPONSE",
        "422, DESTINATION_REQUIRED, 503, ROUTE_INVALID_RESPONSE",
        "400, VALIDATION, 503, ROUTE_INVALID_RESPONSE",
        "503, OUT_OF_AREA, 503, ROUTE_INVALID_RESPONSE",
        "502, BAD_GATEWAY, 503, ROUTE_INVALID_RESPONSE",
        "504, TIMEOUT, 503, ROUTE_INVALID_RESPONSE",
        "201, BUSY, 503, ROUTE_INVALID_RESPONSE"
    })
    void Route_오류는_허용목록으로만_매핑하고_재시도하지_않는다(
            int routeStatus, String routeCode, int publicStatus, String reason) {
        SERVER.respond(
                routeStatus,
                "{\"code\":\"" + routeCode + "\",\"message\":\"secret upstream detail 35.17,129.07\","
                        + "\"details\":{\"debug\":\"traceback\"}}");

        ApiException failure =
                failureOf(() -> adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));

        assertThat(failure.status().value()).isEqualTo(publicStatus);
        assertThat(failure.code()).isEqualTo(publicStatus == 422 ? "INVALID_SEARCH" : "SERVICE_UNAVAILABLE");
        assertThat(failure.details()).containsExactly(Map.entry("reason", reason));
        assertThat(failure.getMessage()).doesNotContain("secret", "35.17", "traceback");
        assertThat(SERVER.received()).hasSize(1);
    }

    @Test
    void 오류본문이_JSON이_아니면_INVALID_RESPONSE다() {
        SERVER.respond(503, "<html>503 Service Temporarily Unavailable</html>");

        ApiException failure =
                failureOf(() -> adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));

        assertThat(failure.details()).containsEntry("reason", "ROUTE_INVALID_RESPONSE");
    }

    @Test
    void 응답본문이_256KB를_넘으면_길이표시와_청크전송_모두_INVALID_RESPONSE다() {
        var body = RouteFixtures.success(1);
        firstRoute(body).put("padding", "x".repeat(RouteHttpCourseRecommendAdapter.MAX_RESPONSE_BYTES));
        byte[] payload = json(body).getBytes(StandardCharsets.UTF_8);

        for (boolean chunked : List.of(false, true)) {
            SERVER.reset();
            SERVER.respond(200, payload).chunked(chunked);
            ApiException failure =
                    failureOf(() -> adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));
            assertThat(failure.details()).containsEntry("reason", "ROUTE_INVALID_RESPONSE");
        }
    }

    @Test
    void 경계_크기_이하의_청크전송_성공응답은_받는다() {
        SERVER.respond(200, json(RouteFixtures.success(3))).chunked(true);

        GeneratedCourses result =
                adapter.recommend(loop(CourseRecommendFilters.allOff()), farDeadline());

        assertThat(result.courses()).hasSize(3);
    }

    @Test
    void Route_전체_호출상한을_넘기면_ROUTE_TIMEOUT으로_포기한다() {
        SERVER.respond(200, json(RouteFixtures.success(1))).delay(Duration.ofSeconds(3));
        var shortRoute = adapter(SERVER.baseUri(), Duration.ofMillis(300));

        long started = System.nanoTime();
        ApiException failure =
                failureOf(() -> shortRoute.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));
        Duration elapsed = Duration.ofNanos(System.nanoTime() - started);

        assertThat(failure.details()).containsEntry("reason", "ROUTE_TIMEOUT");
        assertThat(elapsed).isLessThan(Duration.ofSeconds(2));
    }

    @Test
    void C01_전체예산이_Route_상한보다_먼저_끝나면_GENERATION_TIMEOUT이다() {
        SERVER.respond(200, json(RouteFixtures.success(1))).delay(Duration.ofSeconds(3));

        long started = System.nanoTime();
        ApiException failure =
                failureOf(
                        () ->
                                adapter.recommend(
                                        loop(CourseRecommendFilters.allOff()),
                                        Instant.now().plusMillis(300)));
        Duration elapsed = Duration.ofNanos(System.nanoTime() - started);

        assertThat(failure.code()).isEqualTo("SERVICE_UNAVAILABLE");
        assertThat(failure.getMessage()).isEqualTo("코스 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
        assertThat(failure.details()).containsEntry("reason", "GENERATION_TIMEOUT");
        assertThat(elapsed.toMillis()).isCloseTo(300L, within(1_500L));
    }

    @Test
    void 이미_지난_전체예산이면_Route를_호출하지_않는다() {
        ApiException failure =
                failureOf(
                        () ->
                                adapter.recommend(
                                        loop(CourseRecommendFilters.allOff()),
                                        Instant.now().minusMillis(1)));

        assertThat(failure.details()).containsEntry("reason", "GENERATION_TIMEOUT");
        assertThat(SERVER.received()).isEmpty();
    }

    @Test
    void 연결할수_없으면_ROUTE_UNAVAILABLE이다() throws Exception {
        int closedPort;
        try (ServerSocket socket = new ServerSocket(0)) {
            closedPort = socket.getLocalPort();
        }
        var unreachable = adapter(URI.create("http://127.0.0.1:" + closedPort), Duration.ofSeconds(15));

        ApiException failure =
                failureOf(() -> unreachable.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()));

        assertThat(failure.details()).containsEntry("reason", "ROUTE_UNAVAILABLE");
    }

    @Test
    void 주소가_설정되지_않으면_호출없이_ROUTE_UNAVAILABLE이다() {
        var missing = adapter(null, Duration.ofSeconds(15));

        assertThatThrownBy(() -> missing.recommend(loop(CourseRecommendFilters.allOff()), farDeadline()))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        ex -> assertThat(ex.details()).containsEntry("reason", "ROUTE_UNAVAILABLE"));
        assertThat(SERVER.received()).isEmpty();
    }
}
