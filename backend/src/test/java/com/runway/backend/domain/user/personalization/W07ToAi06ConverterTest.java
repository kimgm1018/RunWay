package com.runway.backend.domain.user.personalization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.domain.user.personalization.Ai06Sample.Quality;
import com.runway.backend.domain.user.personalization.Ai06Session.WorkoutQuality;
import com.runway.backend.domain.user.personalization.W07RoutePoint.DeviceType;
import com.runway.backend.domain.user.personalization.W07ToAi06Converter.Reason;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * W07 → AI06 변환기를 AI 담당 fixture({@code ai/service/tests/fixtures/w07_ai06})로 검증한다. Python 참고 구현 테스트({@code
 * test_w07_ai06_conversion.py})와 같은 기대값을 쓴다. fixture의 {@code demAltitudeM}은 (경도, 위도)로 찾는 가짜 DEM으로
 * 주입한다. 러닝 선택(COMPLETED·최신순·50개)은 변환기 책임이 아니라 여기서 다루지 않는다.
 */
class W07ToAi06ConverterTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Path FIXTURES = fixtureDir();
    private final W07ToAi06Converter converter = new W07ToAi06Converter();

    @ParameterizedTest
    @ValueSource(strings = {"normal", "missing", "pause", "low_quality", "mixed_gps"})
    void 변환_결과가_fixture의_ai06_request와_같다(String name) throws IOException {
        JsonNode src = load(name, "w07");
        ElevationSource dem = demFor(src);
        List<Ai06Session> converted = new ArrayList<>();
        for (W07Session session : sessions(src)) {
            converted.add(converter.convert(session, dem).orElseThrow());
        }
        Ai06PersonalizeRequest actual =
                new Ai06PersonalizeRequest(src.get("userId").asLong(), converted);

        List<String> diffs = new ArrayList<>();
        compare("$", load(name, "ai06_request"), MAPPER.valueToTree(actual), diffs);
        assertThat(diffs).as("%s: 기대 JSON과 다른 값", name).isEmpty();
    }

    @Test
    void 정상_첫_행은_학습_시작_규칙을_따른다() throws IOException {
        Map<Integer, Ai06Sample> rows = rows("normal");
        assertThat(rows.get(0).hrQuality()).isEqualTo(Quality.GOOD);
        assertThat(rows.get(0).hrIsFilled()).isFalse(); // 출발 HR = 실측
        assertThat(rows.get(0).speedQuality()).isEqualTo(Quality.MISSING);
        assertThat(rows.get(0).gradeQuality()).isEqualTo(Quality.MISSING);
        assertThat(rows.get(10).speedMps()).isEqualTo(2.8);
        assertThat(rows.get(25).gradePercent()).isEqualTo(2.0); // DEM 2% 오르막
    }

    @Test
    void 결측_HR은_15초까지_채움으로_이어_쓰고_그_뒤는_MISSING이다() throws IOException {
        Map<Integer, Ai06Sample> rows = rows("missing"); // 공백 전 마지막 HR 57초, 다음 112초
        assertThat(rows.get(60).hrIsFilled()).isFalse();
        assertThat(rows.get(65).hrIsFilled()).isTrue();
        assertThat(rows.get(70).hrIsFilled()).isTrue();
        assertThat(rows.get(70).hrBpm()).isEqualTo(rows.get(60).hrBpm());
        assertThat(rows.get(75).hrBpm()).isNull();
        assertThat(rows.get(75).hrQuality()).isEqualTo(Quality.MISSING);
        assertThat(rows.get(75).hrIsFilled()).isFalse();
        assertThat(rows.get(115).hrQuality()).isEqualTo(Quality.GOOD);
        assertThat(rows.get(115).hrIsFilled()).isFalse();
        assertThat(rows.get(130).speedQuality()).isEqualTo(Quality.MISSING); // 누적 거리 공백
    }

    @Test
    void 멈춤은_활동시간이_아니라_벽시계_시각을_쓴다() throws IOException {
        Ai06Session session = convert("pause");
        Map<Integer, Ai06Sample> rows = index(session);
        assertThat(rows).hasSize(73); // 360초 벽시계. active 시간이면 55행
        assertThat(rows.get(160).hrIsFilled()).isTrue(); // 멈춤 직후 15초는 마지막 HR을 채움으로 이어 쓴다
        for (int t = 170; t < 240; t += 5) {
            assertThat(rows.get(t).hrQuality()).isEqualTo(Quality.MISSING);
        }
        assertThat(rows.get(240).hrQuality()).isEqualTo(Quality.GOOD);
        assertThat(rows.get(240).speedQuality()).isEqualTo(Quality.MISSING); // 멈춤 뒤 첫 거리 간격은 새 구간
        assertThat(session.workoutQuality()).isEqualTo(WorkoutQuality.USABLE_WITH_FLAGS);
    }

    @Test
    void 저품질은_튄_값을_버리고_그_칸만_LOW이며_러닝은_UNUSABLE이다() throws IOException {
        Ai06Session session = convert("low_quality");
        Map<Integer, Ai06Sample> rows = index(session);
        assertThat(rows.get(15).hrQuality()).isEqualTo(Quality.LOW); // HR 튐은 버리고 그 칸만 LOW
        assertThat(rows.get(15).hrBpm()).isEqualTo(109.0);
        assertThat(rows.get(150).speedQuality()).isEqualTo(Quality.LOW);
        assertThat(rows.get(150).speedMps()).isEqualTo(2.8);
        assertThat(session.workoutQuality()).isEqualTo(WorkoutQuality.UNUSABLE);
    }

    @Test
    void HR_측정이_하나도_없으면_NO_START_HR이다() throws IOException {
        JsonNode src = load("normal", "w07");
        W07Session normal = sessions(src).get(0);
        W07Session noHr =
                new W07Session(
                        1,
                        normal.startedAt(),
                        normal.samples().stream().filter(s -> !s.hrMeasured()).toList(),
                        normal.routePoints());
        W07ToAi06Converter.Result result = converter.convertWithReason(noHr, demFor(src));
        assertThat(result.session()).isNull();
        assertThat(result.reason()).isEqualTo(Reason.NO_START_HR);
        assertThat(converter.convert(noHr, demFor(src))).isEmpty();
    }

    @Test
    void 짧은_러닝은_보내지_않는다() throws IOException {
        JsonNode src = load("normal", "w07");
        W07Session normal = sessions(src).get(0);
        Instant cut = Instant.parse("2026-11-01T00:01:58Z"); // 24행 = 115초
        W07Session shortRun =
                new W07Session(
                        1,
                        normal.startedAt(),
                        normal.samples().stream().filter(s -> s.measuredAt().isBefore(cut)).toList(),
                        normal.routePoints().stream().filter(p -> p.measuredAt().isBefore(cut)).toList());
        W07ToAi06Converter.Result result = converter.convertWithReason(shortRun, demFor(src));
        assertThat(result.session()).isNull();
        assertThat(result.reason()).isEqualTo(Reason.TOO_SHORT);
    }

    @Test
    void 워치_GPS를_먼저_쓰고_끊긴_구간만_폰_점으로_채운다() throws IOException {
        JsonNode src = load("mixed_gps", "w07");
        Map<Integer, Ai06Sample> rows = rows("mixed_gps");
        // 워치 GPS가 끊긴 78~148초도 폰 점으로 채워 2% 오르막이 그대로 이어진다
        for (int t = 25; t < 235; t += 5) {
            Ai06Sample row = rows.get(t);
            assertThat(row.gradeQuality()).isEqualTo(Quality.GOOD);
            assertThat(Math.abs(row.gradePercent() - 2.0)).isLessThanOrEqualTo(0.05);
        }
        // 두 기기 점을 모두 이으면 옆으로 3.6m 떨어진 점을 오가며 거리가 부풀어 경사가 틀어진다
        W07Session mixed = sessions(src).get(0);
        List<W07RoutePoint> allWatch =
                mixed.routePoints().stream()
                        .map(
                                p ->
                                        new W07RoutePoint(
                                                p.measuredAt(),
                                                p.longitude(),
                                                p.latitude(),
                                                DeviceType.WATCH))
                        .toList();
        W07Session naive =
                new W07Session(mixed.sessionId(), mixed.startedAt(), mixed.samples(), allWatch);
        Ai06Session out = converter.convert(naive, demFor(src)).orElseThrow();
        assertThat(index(out).get(50).gradePercent()).isLessThan(1.7);
    }

    @Test
    void AI06_속도_범위_0에서_15_밖이면_그_칸은_null과_MISSING이다() throws IOException {
        // 누적 거리를 없애 워치 speed 폴백 경로로 변환한다(거리 경로는 8m/s 초과를 버려 15 초과가 나오기 어렵다).
        assertThat(speedRowAt10(3.0).speedMps()).isEqualTo(3.0); // 범위 안: 그대로
        assertThat(speedRowAt10(3.0).speedQuality()).isEqualTo(Quality.GOOD);

        Ai06Sample boundary = speedRowAt10(W07ToAi06Converter.AI_SPEED_MAX_MPS);
        assertThat(boundary.speedMps()).isEqualTo(15.0); // 15는 허용(7 초과라 LOW)
        assertThat(boundary.speedQuality()).isEqualTo(Quality.LOW);

        for (double outOfRange : new double[] {15.5, 20.0, -0.5}) {
            Ai06Sample row = speedRowAt10(outOfRange);
            assertThat(row.speedMps()).as("speed=%s", outOfRange).isNull();
            assertThat(row.speedQuality()).as("speed=%s", outOfRange).isEqualTo(Quality.MISSING);
            assertThat(row.hrQuality()).isNotEqualTo(Quality.MISSING); // 다른 지표는 영향 없음
        }
    }

    private Ai06Sample speedRowAt10(double speed) throws IOException {
        JsonNode src = load("normal", "w07");
        W07Session normal = sessions(src).get(0);
        List<W07MetricSample> samples =
                normal.samples().stream()
                        .map(
                                s ->
                                        new W07MetricSample(
                                                s.measuredAt(),
                                                s.heartRate(),
                                                s.hrMeasured(),
                                                null,
                                                s.speed() == null ? null : speed))
                        .toList();
        W07Session session =
                new W07Session(normal.sessionId(), normal.startedAt(), samples, normal.routePoints());
        return index(converter.convert(session, demFor(src)).orElseThrow()).get(10);
    }

    @Test
    void 알_수_없는_기기_종류는_PHONE이다() {
        assertThat(DeviceType.fromDb(null)).isEqualTo(DeviceType.PHONE);
        assertThat(DeviceType.fromDb("WATCH")).isEqualTo(DeviceType.WATCH);
    }

    @Test
    void GPS_경로점이_없으면_경사는_전부_MISSING이다() throws IOException {
        JsonNode src = load("normal", "w07");
        W07Session normal = sessions(src).get(0);
        W07Session noGps =
                new W07Session(normal.sessionId(), normal.startedAt(), normal.samples(), List.of());
        Ai06Session out = converter.convert(noGps, demFor(src)).orElseThrow();
        assertAllGradeMissing(out);
    }

    @Test
    void DEM_밖_점은_빼서_경사가_MISSING이다() throws IOException {
        W07Session normal = sessions(load("normal", "w07")).get(0);
        assertAllGradeMissing(converter.convert(normal, (lon, lat) -> Double.NaN).orElseThrow());
    }

    @Test
    void DEM이_없으면_경사는_MISSING이다() throws IOException {
        W07Session normal = sessions(load("normal", "w07")).get(0);
        assertAllGradeMissing(converter.convert(normal, null).orElseThrow());
    }

    @Test
    void DEM_읽기_실패는_실행을_멈추지_않고_그_점만_DEM_밖처럼_뺀다() throws IOException {
        JsonNode src = load("normal", "w07");
        W07Session normal = sessions(src).get(0);
        ElevationSource dem = demFor(src);
        // 모든 점이 실패하면 DEM이 없을 때와 같이 경사가 전부 MISSING이다.
        ElevationSource broken =
                (lon, lat) -> {
                    throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
                };
        assertAllGradeMissing(converter.convert(normal, broken).orElseThrow());

        // 일부 점만 실패하면 그 점을 NaN(DEM 밖)으로 준 결과와 같다.
        java.util.concurrent.atomic.AtomicInteger failures =
                new java.util.concurrent.atomic.AtomicInteger();
        ElevationSource partlyBroken =
                (lon, lat) -> {
                    if (failsAt(lon, lat)) {
                        failures.incrementAndGet();
                        throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
                    }
                    return dem.elevationAt(lon, lat);
                };
        ElevationSource partlyOutside =
                (lon, lat) -> failsAt(lon, lat) ? Double.NaN : dem.elevationAt(lon, lat);
        Ai06Session actual = converter.convert(normal, partlyBroken).orElseThrow();
        assertThat(failures.get()).isPositive();
        assertThat(actual).isEqualTo(converter.convert(normal, partlyOutside).orElseThrow());
        assertThat(actual.samples()).anySatisfy(s -> assertThat(s.gradePercent()).isNotNull());
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void DEM_경고는_여러_러닝을_포함한_개인화_실행마다_한번이다(CapturedOutput output) throws IOException {
        W07Session session = sessions(load("normal", "w07")).get(0);
        ElevationSource broken = (lon, lat) -> {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        };
        for (int run = 0; run < 2; run++) {
            ElevationSource scoped = W07ToAi06Converter.demForRun(broken);
            for (int workout = 0; workout < 3; workout++) {
                assertAllGradeMissing(converter.convert(session, scoped).orElseThrow());
            }
        }
        assertThat(output.getAll().lines().filter(line -> line.contains("DEM 고도 읽기 실패:")))
                .hasSize(2);
    }

    @Test
    void DEM_계산_불변식_오류는_삼키지_않는다() throws IOException {
        W07Session normal = sessions(load("normal", "w07")).get(0);
        ElevationSource bug =
                (lon, lat) -> {
                    throw new IllegalStateException("invariant");
                };
        assertThatThrownBy(() -> converter.convert(normal, bug))
                .isInstanceOf(IllegalStateException.class);
    }

    /** 경로점 약 3개 중 1개를 결정적으로 고른다. */
    private static boolean failsAt(double lon, double lat) {
        return Math.floorMod(Double.hashCode(lon) * 31 + Double.hashCode(lat), 3) == 0;
    }

    @Test
    void 요청은_JSON으로_직렬화된다() throws IOException {
        JsonNode src = load("normal", "w07");
        Ai06PersonalizeRequest request =
                new Ai06PersonalizeRequest(73, List.of(convert("normal")));
        JsonNode json = MAPPER.valueToTree(request);
        JsonNode session = json.get("sessions").get(0);
        JsonNode first = session.get("samples").get(0);
        assertThat(json.get("userId").asLong()).isEqualTo(73);
        assertThat(session.get("sessionStartedAt").asString()).isEqualTo("2026-11-01T00:00:02Z");
        assertThat(first.get("hrQuality").asString()).isEqualTo("GOOD");
        assertThat(first.has("speedMps")).isTrue();
        assertThat(first.get("speedMps").isNull()).isTrue(); // null도 필수 키로 내보낸다
        assertThat(first.get("hrIsFilled").asBoolean()).isFalse();
        assertThat(src.get("userId").asLong()).isEqualTo(73);
    }

    // ---- 도우미 ----

    private static void assertAllGradeMissing(Ai06Session out) {
        assertThat(out.samples()).isNotEmpty();
        assertThat(out.samples())
                .allSatisfy(
                        s -> {
                            assertThat(s.gradePercent()).isNull();
                            assertThat(s.gradeQuality()).isEqualTo(Quality.MISSING);
                        });
    }

    private static Path fixtureDir() {
        Path[] candidates = {
            Path.of("..", "ai", "service", "tests", "fixtures", "w07_ai06"),
            Path.of("ai", "service", "tests", "fixtures", "w07_ai06")
        };
        for (Path p : candidates) {
            if (Files.isDirectory(p)) {
                return p;
            }
        }
        throw new IllegalStateException("w07_ai06 fixture 디렉터리를 찾을 수 없습니다");
    }

    private static JsonNode load(String name, String kind) throws IOException {
        return MAPPER.readTree(
                Files.readString(FIXTURES.resolve(name + "." + kind + ".json"), StandardCharsets.UTF_8));
    }

    private Ai06Session convert(String name) throws IOException {
        JsonNode src = load(name, "w07");
        return converter.convert(sessions(src).get(0), demFor(src)).orElseThrow();
    }

    private Map<Integer, Ai06Sample> rows(String name) throws IOException {
        return index(convert(name));
    }

    private static Map<Integer, Ai06Sample> index(Ai06Session session) {
        Map<Integer, Ai06Sample> rows = new HashMap<>();
        for (Ai06Sample s : session.samples()) {
            rows.put(s.elapsedSec(), s);
        }
        return rows;
    }

    /** fixture 경로점의 demAltitudeM을 (경도, 위도)로 찾는 가짜 DEM. 값이 null인 점은 NaN(DEM 밖). */
    private static ElevationSource demFor(JsonNode src) {
        Map<String, Double> dem = new HashMap<>();
        for (JsonNode session : src.get("sessions")) {
            for (JsonNode p : session.get("routePoints")) {
                if (p.get("demAltitudeM").isNull()) {
                    continue;
                }
                String key = key(p.get("longitude").asDouble(), p.get("latitude").asDouble());
                double alt = p.get("demAltitudeM").asDouble();
                Double prev = dem.put(key, alt);
                assertThat(prev == null || prev == alt).as("같은 좌표의 서로 다른 고도: %s", key).isTrue();
            }
        }
        return (lon, lat) -> dem.getOrDefault(key(lon, lat), Double.NaN);
    }

    private static String key(double lon, double lat) {
        return Double.doubleToLongBits(lon) + "," + Double.doubleToLongBits(lat);
    }

    private static List<W07Session> sessions(JsonNode src) {
        List<W07Session> out = new ArrayList<>();
        for (JsonNode s : src.get("sessions")) {
            List<W07MetricSample> metric = new ArrayList<>();
            for (JsonNode m : s.get("metricSamples")) {
                metric.add(
                        new W07MetricSample(
                                Instant.parse(m.get("measuredAt").asString()),
                                number(m, "heartRateBpm"),
                                m.get("isHrMeasured").asBoolean(),
                                number(m, "totalDistanceM"),
                                number(m, "speedMps")));
            }
            List<W07RoutePoint> route = new ArrayList<>();
            for (JsonNode p : s.get("routePoints")) {
                route.add(
                        new W07RoutePoint(
                                Instant.parse(p.get("measuredAt").asString()),
                                p.get("longitude").asDouble(),
                                p.get("latitude").asDouble(),
                                DeviceType.fromDb(p.get("deviceType").asString())));
            }
            out.add(
                    new W07Session(
                            s.get("sessionId").asLong(),
                            Instant.parse(s.get("startedAt").asString()),
                            metric,
                            route));
        }
        return out;
    }

    private static Double number(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asDouble();
    }

    /**
     * 의미 동등 비교. 숫자는 Python 테스트처럼 정확히 같아야 하고(속도 소수 3자리·경사 2자리 반올림 결과), 키 집합과 null도 같아야 한다.
     * 시각 문자열은 Instant로 파싱해 비교한다.
     */
    private static void compare(String path, JsonNode expected, JsonNode actual, List<String> diffs) {
        if (diffs.size() >= 20) {
            return;
        }
        if (expected.isObject() && actual.isObject()) {
            TreeSet<String> keys = new TreeSet<>(expected.propertyNames());
            keys.addAll(actual.propertyNames());
            for (String key : keys) {
                if (!expected.has(key) || !actual.has(key)) {
                    diffs.add(path + "." + key + " 키 누락/초과");
                    continue;
                }
                compare(path + "." + key, expected.get(key), actual.get(key), diffs);
            }
        } else if (expected.isArray() && actual.isArray()) {
            if (expected.size() != actual.size()) {
                diffs.add(path + " 길이 " + expected.size() + " != " + actual.size());
                return;
            }
            for (int i = 0; i < expected.size(); i++) {
                compare(path + "[" + i + "]", expected.get(i), actual.get(i), diffs);
            }
        } else if (expected.isNumber() && actual.isNumber()) {
            if (expected.asDouble() != actual.asDouble()) {
                diffs.add(path + " " + expected.asDouble() + " != " + actual.asDouble());
            }
        } else if (path.endsWith(".sessionStartedAt") && expected.isString() && actual.isString()) {
            if (!Instant.parse(expected.asString()).equals(Instant.parse(actual.asString()))) {
                diffs.add(path + " " + expected + " != " + actual);
            }
        } else if (!expected.equals(actual)) {
            diffs.add(path + " " + expected + " != " + actual);
        }
    }
}
