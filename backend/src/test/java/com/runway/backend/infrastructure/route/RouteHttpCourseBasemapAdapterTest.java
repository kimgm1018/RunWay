package com.runway.backend.infrastructure.route;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.course.basemap.BasemapBbox;
import com.runway.backend.domain.course.basemap.BasemapFeature;
import com.runway.backend.domain.course.basemap.BasemapFeature.Kind;
import com.runway.backend.domain.course.basemap.BasemapFeature.RoadClass;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.BasemapResult;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Failure;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.OutOfArea;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Success;
import java.net.ServerSocket;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-612 Route 바탕 지도 어댑터(detail full): 요청 형식, 응답 검증(건물·도로 등급·개수 상한), 오류 매핑, 시간·크기 상한. 모든 값은 합성 데이터다. */
class RouteHttpCourseBasemapAdapterTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final FakeRouteServer SERVER = new FakeRouteServer();
    private static final BasemapBbox BBOX = new BasemapBbox(129.0, 35.0, 129.05, 35.04);
    private static final double MPP = 3.9682539;

    private static final String ROAD =
            "{\"kind\":\"road\",\"geometry\":{\"type\":\"LineString\","
                    + "\"coordinates\":[[129.01,35.01],[129.02,35.02]]},\"osm_id\":1}";
    private static final String PARK =
            "{\"kind\":\"park\",\"geometry\":{\"type\":\"Polygon\",\"coordinates\":"
                    + "[[[129.01,35.01],[129.02,35.01],[129.02,35.02],[129.01,35.01]]]}}";
    private static final String SEA =
            "{\"kind\":\"sea\",\"geometry\":{\"type\":\"Polygon\",\"coordinates\":"
                    + "[[[129.03,35.0],[129.05,35.0],[129.05,35.02],[129.03,35.0]]]}}";

    private static String road(String roadClassJson) {
        return "{\"kind\":\"road\",\"road_class\":"
                + roadClassJson
                + ",\"geometry\":{\"type\":\"LineString\","
                + "\"coordinates\":[[129.01,35.01],[129.02,35.02]]}}";
    }

    private final RouteHttpCourseBasemapAdapter adapter = adapter(SERVER.baseUri(), 8 * 1024 * 1024);

    @AfterAll
    static void stopServer() {
        SERVER.close();
    }

    @BeforeEach
    void resetServer() {
        SERVER.reset();
    }

    private static RouteHttpCourseBasemapAdapter adapter(URI base, int maxBytes) {
        return new RouteHttpCourseBasemapAdapter(
                base, Duration.ofSeconds(1), Duration.ofSeconds(3), maxBytes, JSON);
    }

    private static String body(String timestamp, String... features) {
        return "{\"osm_data_timestamp\":"
                + (timestamp == null ? "null" : "\"" + timestamp + "\"")
                + ",\"buildings_available\":true,\"buildings_osm_data_timestamp\":null"
                + ",\"features\":["
                + String.join(",", features)
                + "]}";
    }

    private static String building(String heightJson) {
        return "{\"kind\":\"building\",\"height_m\":"
                + heightJson
                + ",\"geometry\":{\"type\":\"Polygon\",\"coordinates\":"
                + "[[[129.01,35.01],[129.011,35.01],[129.011,35.011],[129.01,35.01]]]}}";
    }

    private static Success success(BasemapResult result) {
        assertThat(result).isInstanceOf(Success.class);
        return (Success) result;
    }

    @Test
    void 범위와_전체_상세와_축척만_보내고_정상_응답의_지형지물과_기준시각을_돌려준다() {
        SERVER.respond(
                200,
                "{\"osm_data_timestamp\":\"2026-10-20T03:00:00Z\",\"buildings_available\":true,"
                        + "\"buildings_osm_data_timestamp\":\"2026-10-19T00:00:00Z\",\"features\":["
                        + ROAD + "," + PARK + "," + building("12.5") + "]}");

        BasemapResult result = adapter.fetch(7L, BBOX, MPP);

        assertThat(SERVER.received()).singleElement().satisfies(received -> {
            assertThat(received.method()).isEqualTo("POST");
            assertThat(received.path()).isEqualTo("/internal/v1/basemaps");
            JsonNode request = JSON.readTree(received.body());
            assertThat(request.propertyNames()).containsExactly("bbox", "detail", "meters_per_pixel");
            // 썸네일 축척(m/px)은 소수 셋째 자리까지 보낸다.
            assertThat(request.get("meters_per_pixel").doubleValue()).isEqualTo(3.968);
            assertThat(request.get("detail").stringValue()).isEqualTo("full");
            assertThat(request.get("bbox").size()).isEqualTo(4);
            assertThat(request.get("bbox").get(0).doubleValue()).isEqualTo(129.0);
            assertThat(request.get("bbox").get(3).doubleValue()).isEqualTo(35.04);
        });
        Success success = success(result);
        assertThat(success.osmDataTimestamp()).isEqualTo(Instant.parse("2026-10-20T03:00:00Z"));
        assertThat(success.buildingsAvailable()).isTrue();
        assertThat(success.buildingsOsmDataTimestamp())
                .isEqualTo(Instant.parse("2026-10-19T00:00:00Z"));
        List<BasemapFeature> features = success.features();
        assertThat(features).hasSize(3);
        assertThat(features.get(0).kind()).isEqualTo(Kind.ROAD);
        assertThat(features.get(0).polygon()).isFalse();
        assertThat(features.get(0).parts()).singleElement()
                .satisfies(p -> assertThat(p).containsExactly(129.01, 35.01, 129.02, 35.02));
        assertThat(features.get(1).kind()).isEqualTo(Kind.PARK);
        assertThat(features.get(1).polygon()).isTrue();
        assertThat(features.get(1).parts().get(0)).hasSize(8);
        assertThat(features.get(2).kind()).isEqualTo(Kind.BUILDING);
        assertThat(features.get(2).heightM()).isEqualTo(12.5);
    }

    @Test
    void 바다와_도로_등급과_산책로_등급을_받는다() {
        SERVER.respond(
                200,
                body(
                        null,
                        road("\"primary\""),
                        road("\"living_street\""),
                        road("\"footway\""),
                        road("\"pedestrian\""),
                        road("\"path\""),
                        road("\"cycleway\""),
                        ROAD,
                        road("null"),
                        SEA));

        List<BasemapFeature> features = success(adapter.fetch(7L, BBOX, MPP)).features();

        assertThat(features).extracting(BasemapFeature::roadClass)
                .containsExactly(
                        RoadClass.PRIMARY,
                        RoadClass.LIVING_STREET,
                        RoadClass.FOOTWAY,
                        RoadClass.PEDESTRIAN,
                        RoadClass.PATH,
                        RoadClass.CYCLEWAY,
                        null,
                        null,
                        null);
        assertThat(features.get(8).kind()).isEqualTo(Kind.SEA);
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"service\"", "\"PRIMARY\"", "\"\"", "1", "[\"primary\"]"})
    void 목록_밖_도로_등급은_실패다(String roadClassJson) {
        SERVER.respond(200, body(null, ROAD, road(roadClassJson)));

        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"river", "water", "sea", "coast", "beach", "park", "green"})
    void 도로가_아닌_지형지물의_도로_등급과_건물이_아닌_높이는_실패다(String kind) {
        String withClass =
                "{\"kind\":\""
                        + kind
                        + "\",\"road_class\":\"primary\",\"geometry\":{\"type\":\"LineString\","
                        + "\"coordinates\":[[129.01,35.01],[129.02,35.02]]}}";
        String withoutClass = withClass.replace(",\"road_class\":\"primary\"", "");
        String withHeight = withClass.replace("\"road_class\":\"primary\"", "\"height_m\":3");

        SERVER.respond(200, body(null, withoutClass));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isInstanceOf(Success.class);

        SERVER.respond(200, body(null, withClass));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));

        SERVER.respond(200, body(null, withHeight));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "3", "999.5", "1000"})
    void 건물_높이는_0에서_1000m까지_받는다(String heightJson) {
        SERVER.respond(200, body(null, building(heightJson)));

        assertThat(success(adapter.fetch(7L, BBOX, MPP)).features().get(0).heightM())
                .isEqualTo(Double.parseDouble(heightJson));
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "1000.5", "null", "\"10\"", "true"})
    void 건물_높이가_없거나_범위_밖이면_실패다(String heightJson) {
        SERVER.respond(200, body(null, building(heightJson)));

        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @Test
    void 선_모양_건물과_높이_없는_건물은_실패다() {
        String lineBuilding =
                "{\"kind\":\"building\",\"height_m\":9,\"geometry\":{\"type\":\"LineString\","
                        + "\"coordinates\":[[129.01,35.01],[129.02,35.02]]}}";
        SERVER.respond(200, body(null, lineBuilding));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));

        String noHeight = building("9").replace("\"height_m\":9,", "");
        SERVER.respond(200, body(null, noHeight));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @Test
    void buildings_available이_불리언이_아니면_실패다() {
        SERVER.respond(200, "{\"osm_data_timestamp\":null,\"features\":[]}");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));

        SERVER.respond(200, "{\"buildings_available\":\"true\",\"features\":[]}");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));

        SERVER.respond(200, "{\"buildings_available\":false,\"features\":[]}");
        Success success = success(adapter.fetch(7L, BBOX, MPP));
        assertThat(success.buildingsAvailable()).isFalse();
        assertThat(success.buildingsOsmDataTimestamp()).isNull();
    }

    @Test
    void 지형지물이_없고_기준시각이_null이어도_성공이다() {
        SERVER.respond(200, body(null));

        Success success = success(adapter.fetch(7L, BBOX, MPP));

        assertThat(success.features()).isEmpty();
        assertThat(success.osmDataTimestamp()).isNull();
    }

    @Test
    void 기준시각_오프셋_표기도_해석하고_잘못된_값은_비운다() {
        SERVER.respond(200, body("2026-10-20T12:00:00+09:00", ROAD));
        assertThat(success(adapter.fetch(7L, BBOX, MPP)).osmDataTimestamp())
                .isEqualTo(Instant.parse("2026-10-20T03:00:00Z"));

        SERVER.respond(200, body("yesterday", ROAD));
        assertThat(success(adapter.fetch(7L, BBOX, MPP)).osmDataTimestamp()).isNull();
    }

    @Test
    void 지형지물_50000개는_성공이고_50001개는_실패다() {
        String[] max = new String[50_000];
        java.util.Arrays.fill(max, ROAD);
        SERVER.respond(200, body(null, max));
        assertThat(success(adapter.fetch(7L, BBOX, MPP)).features()).hasSize(50_000);

        String[] over = new String[50_001];
        java.util.Arrays.fill(over, ROAD);
        SERVER.respond(200, body(null, over));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @Test
    void 좌표_400000점은_성공이고_넘으면_실패다() {
        // 선 하나에 1,000점 × 400개 = 400,000점.
        StringBuilder line = new StringBuilder("{\"kind\":\"road\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":[");
        for (int i = 0; i < 1_000; i++) {
            line.append(i == 0 ? "" : ",").append("[129.01,35.01]");
        }
        line.append("]}}");
        String[] features = new String[400];
        java.util.Arrays.fill(features, line.toString());
        SERVER.respond(200, body(null, features));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isInstanceOf(Success.class);

        String[] over = java.util.Arrays.copyOf(features, 401);
        over[400] = ROAD;
        SERVER.respond(200, body(null, over));
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "not-json",
                "[]",
                "{\"features\":{}}",
                "{\"osm_data_timestamp\":null}",
                "{\"features\":[{\"kind\":\"tree\",\"geometry\":{\"type\":\"LineString\","
                        + "\"coordinates\":[[129.0,35.0],[129.1,35.1]]}}]}",
                "{\"features\":[{\"kind\":\"road\",\"geometry\":{\"type\":\"Point\","
                        + "\"coordinates\":[129.0,35.0]}}]}",
                "{\"features\":[{\"kind\":\"road\",\"geometry\":{\"type\":\"LineString\","
                        + "\"coordinates\":[[129.0,35.0]]}}]}",
                "{\"features\":[{\"kind\":\"road\",\"geometry\":{\"type\":\"LineString\","
                        + "\"coordinates\":[[129.0,35.0],[\"129.1\",35.1]]}}]}",
                "{\"features\":[{\"kind\":\"road\",\"geometry\":{\"type\":\"LineString\","
                        + "\"coordinates\":[[129.0,35.0],[200.0,35.1]]}}]}",
                "{\"features\":[{\"kind\":\"park\",\"geometry\":{\"type\":\"Polygon\","
                        + "\"coordinates\":[[[129.0,35.0],[129.1,35.0],[129.0,35.0]]]}}]}",
                "{\"features\":[{\"kind\":\"park\"}]}"
            })
    void 계약과_다른_200_본문은_실패다(String payload) {
        SERVER.respond(
                200,
                payload.startsWith("{\"features\"")
                        ? "{\"buildings_available\":true," + payload.substring(1)
                        : payload);

        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("INVALID_RESPONSE"));
    }

    @Test
    void 범위_밖_422는_OutOfArea다() {
        SERVER.respond(422, "{\"code\":\"OUT_OF_AREA\",\"message\":\"m\",\"details\":{}}");

        assertThat(adapter.fetch(7L, BBOX, MPP)).isInstanceOf(OutOfArea.class);
    }

    @Test
    void 그_밖의_오류_응답은_실패다() {
        SERVER.respond(400, "{\"code\":\"VALIDATION_ERROR\",\"message\":\"m\",\"details\":{}}");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("HTTP_400_VALIDATION_ERROR"));

        SERVER.respond(503, "{\"code\":\"NOT_READY\",\"message\":\"m\",\"details\":{}}");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("HTTP_503_NOT_READY"));

        SERVER.respond(503, "{\"code\":\"BUSY\",\"message\":\"m\",\"details\":{}}");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("HTTP_503_BUSY"));

        SERVER.respond(500, "<html>oops</html>");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("HTTP_500"));

        // 허용 목록에 없는 코드는 원문을 남기지 않는다.
        SERVER.respond(422, "{\"code\":\"SOMETHING_ELSE\"}");
        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("HTTP_422_UNKNOWN"));
    }

    @Test
    void 시간_초과는_실패다() {
        SERVER.respond(200, body(null, ROAD)).delay(Duration.ofSeconds(4));

        assertThat(adapter.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("TIMEOUT"));
    }

    @Test
    void 본문_상한을_넘으면_실패다() {
        RouteHttpCourseBasemapAdapter small = adapter(SERVER.baseUri(), 64);
        SERVER.respond(200, body(null, ROAD, PARK));
        assertThat(small.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("RESPONSE_TOO_LARGE"));

        SERVER.chunked(true);
        assertThat(small.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("RESPONSE_TOO_LARGE"));
    }

    @Test
    void 연결_실패는_실패다() throws Exception {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        RouteHttpCourseBasemapAdapter closed = adapter(URI.create("http://127.0.0.1:" + port), 1024);

        assertThat(closed.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("UNAVAILABLE"));
    }

    @Test
    void 주소가_없으면_호출하지_않는다() {
        RouteHttpCourseBasemapAdapter none = adapter(null, 1024);

        assertThat(none.isConfigured()).isFalse();
        assertThat(none.fetch(7L, BBOX, MPP)).isEqualTo(new Failure("NOT_CONFIGURED"));
        assertThat(SERVER.received()).isEmpty();
    }

    // --- 준비 상태(GET /internal/v1/ready) ---

    @Test
    void 준비_상태는_GET으로_묻고_200_ready_true만_준비다() {
        SERVER.respond(200, "{\"ready\":true,\"phase\":\"ready\"}");

        assertThat(adapter.isReady()).isTrue();
        assertThat(SERVER.received()).singleElement().satisfies(received -> {
            assertThat(received.method()).isEqualTo("GET");
            assertThat(received.path()).isEqualTo("/internal/v1/ready");
            assertThat(received.body()).isEmpty();
        });
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "503|{\"ready\":false,\"phase\":\"warming\"}",
                "503|{\"ready\":true}",
                "404|{\"detail\":\"Not Found\"}",
                "500|<html>oops</html>",
                "302|",
                "200|{\"ready\":false,\"phase\":\"loading\"}",
                "200|{\"ready\":\"true\"}",
                "200|{\"phase\":\"ready\"}",
                "200|[true]",
                "200|not-json",
                "200|"
            })
    void 그_밖의_준비_상태_응답은_준비되지_않음이다(String scripted) {
        int split = scripted.indexOf('|');
        SERVER.respond(Integer.parseInt(scripted.substring(0, split)), scripted.substring(split + 1));

        assertThat(adapter.isReady()).isFalse();
    }

    @Test
    void 준비_상태_시간_초과_연결_실패_주소_없음은_준비되지_않음이다() throws Exception {
        SERVER.respond(200, "{\"ready\":true}").delay(Duration.ofSeconds(4));
        assertThat(adapter.isReady()).isFalse();
        SERVER.reset();

        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        assertThat(adapter(URI.create("http://127.0.0.1:" + port), 1024).isReady()).isFalse();

        assertThat(adapter(null, 1024).isReady()).isFalse();
        assertThat(SERVER.received()).isEmpty();
    }
}
