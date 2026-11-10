package com.runway.backend.infrastructure.route;

import com.runway.backend.domain.course.basemap.BasemapBbox;
import com.runway.backend.domain.course.basemap.BasemapFeature;
import com.runway.backend.domain.course.basemap.BasemapFeature.Kind;
import com.runway.backend.domain.course.basemap.BasemapFeature.RoadClass;
import com.runway.backend.domain.course.basemap.CourseBasemapPort;

import lombok.extern.slf4j.Slf4j;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodySubscriber;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalLong;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Route 바탕 지도 내부 HTTP 어댑터({@code POST /internal/v1/basemaps}, S15P31E105-612). 기동 시 일괄 채우기 전 준비
 * 상태({@code GET /internal/v1/ready})도 같은 클라이언트·시간 상한으로 확인한다.
 *
 * <ul>
 *   <li>요청은 범위 {@code bbox}, {@code detail "full"}(건물까지 담은 전체 상세)과 썸네일 축척 {@code meters_per_pixel}(선택
 *       필드, Route가 화면에서 보이지 않는 등급·건물을 빼는 데 씀)만 보낸다. 코스 ID·경로·사용자 정보는 보내지 않는다.
 *   <li>연결 상한과 연결을 포함한 전체 호출 상한을 둔다. 자동 재시도·redirect는 하지 않는다.
 *   <li>본문은 설정한 상한(기본 8MB)까지만 읽는다.
 *   <li>200 본문은 계약({@code buildings_available} 불리언, {@code features} 배열 {@value #MAX_FEATURES}개·좌표
 *       {@value #MAX_COORDINATES}점 이하, 정해진 kind, LineString·Polygon 좌표)을 모두 만족할 때만 성공이다. 한 항목이라도
 *       어긋나면 일부만 쓰지 않고 실패로 본다. 지형지물은 저장하지 않고 썸네일을 그리는 데만 쓴다.
 *   <li>{@code road_class}는 {@code road}에만 선택으로 올 수 있고 정해진 도로 등급이어야 한다. {@code height_m}은 {@code
 *       building}(Polygon만)에 필수인 0~{@value #MAX_HEIGHT_M}m 수이고 다른 kind에는 올 수 없다. JSON null은 없는 것으로
 *       본다.
 *   <li>오류는 422 {@code OUT_OF_AREA}만 범위 밖으로 구분하고 나머지는 실패다. 로그에는 상태·허용 목록의 코드만 남기고 상류
 *       message·details·좌표를 남기지 않는다.
 * </ul>
 */
@Slf4j
public final class RouteHttpCourseBasemapAdapter implements CourseBasemapPort {

    static final String BASEMAP_PATH = "/internal/v1/basemaps";
    static final String READY_PATH = "/internal/v1/ready";

    /** 준비 상태 응답 본문 상한(바이트). 작은 JSON 객체만 받는다. */
    static final int MAX_READY_RESPONSE_BYTES = 4 * 1024;
    /** 지형지물 수 상한. Route 계약(약 40,000개)에 여유를 둔다. */
    static final int MAX_FEATURES = 50_000;

    /** 응답 전체 좌표 점 수 상한. Route 계약(약 300,000점)에 여유를 둔다. */
    static final int MAX_COORDINATES = 400_000;

    /** 건물 높이 상한(m). */
    static final double MAX_HEIGHT_M = 1_000;

    /** 요청 상세 수준. 건물까지 담은 전체 상세. */
    static final String DETAIL = "full";

    /** 로그에 남길 수 있는 Route 오류 코드(ai/route_service errors.py). */
    private static final Set<String> KNOWN_ERROR_CODES =
            Set.of(
                    "OUT_OF_AREA", "VALIDATION_ERROR", "NOT_READY", "BUSY", "TIMEOUT", "UNAVAILABLE");

    private final URI endpoint;
    private final URI readyEndpoint;
    private final HttpClient client;
    private final Duration requestTimeout;
    private final int maxResponseBytes;
    private final JsonMapper jsonMapper;

    /**
     * @param baseUri Route origin. null이면 설정 누락으로 보고 호출하지 않는다
     */
    public RouteHttpCourseBasemapAdapter(
            URI baseUri,
            Duration connectTimeout,
            Duration requestTimeout,
            int maxResponseBytes,
            JsonMapper jsonMapper) {
        this.endpoint = baseUri == null ? null : baseUri.resolve(BASEMAP_PATH);
        this.readyEndpoint = baseUri == null ? null : baseUri.resolve(READY_PATH);
        this.client =
                HttpClient.newBuilder()
                        .connectTimeout(connectTimeout)
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .version(HttpClient.Version.HTTP_1_1)
                        .build();
        this.requestTimeout = requestTimeout;
        this.maxResponseBytes = maxResponseBytes;
        this.jsonMapper = jsonMapper;
    }

    @Override
    public boolean isConfigured() {
        return endpoint != null;
    }

    @Override
    public boolean isReady() {
        if (readyEndpoint == null) {
            return false;
        }
        HttpRequest request =
                HttpRequest.newBuilder(readyEndpoint)
                        .timeout(requestTimeout)
                        .header("Accept", "application/json")
                        .GET()
                        .build();
        CompletableFuture<HttpResponse<byte[]>> pending =
                client.sendAsync(
                        request,
                        info ->
                                new LimitedBodySubscriber(
                                        info.headers().firstValueAsLong("Content-Length"),
                                        MAX_READY_RESPONSE_BYTES));
        HttpResponse<byte[]> response;
        try {
            response = pending.get(requestTimeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException ex) {
            pending.cancel(true);
            log.debug("Route 준비 상태 확인 시간 초과");
            return false;
        } catch (InterruptedException ex) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            return false;
        } catch (ExecutionException ex) {
            log.debug("Route 준비 상태 확인 실패 reason={}", transportReason(ex.getCause()));
            return false;
        }
        if (response.statusCode() != 200) {
            log.debug("Route 준비 전 status={}", response.statusCode());
            return false;
        }
        try {
            JsonNode root = jsonMapper.readTree(response.body());
            JsonNode ready = root == null ? null : root.get("ready");
            return ready != null && ready.isBoolean() && ready.booleanValue();
        } catch (RuntimeException ex) {
            log.debug("Route 준비 상태 본문을 해석하지 못함");
            return false;
        }
    }

    @Override
    public BasemapResult fetch(long courseId, BasemapBbox bbox, double metersPerPixel) {
        if (endpoint == null) {
            return new Failure("NOT_CONFIGURED");
        }
        ObjectNode body = jsonMapper.createObjectNode();
        ArrayNode box = body.putArray("bbox");
        box.add(bbox.west()).add(bbox.south()).add(bbox.east()).add(bbox.north());
        body.put("detail", DETAIL);
        if (Double.isFinite(metersPerPixel) && metersPerPixel > 0) {
            // 소수 셋째 자리(약 1mm/px)까지만 보낸다.
            body.put("meters_per_pixel", Math.round(metersPerPixel * 1_000) / 1_000.0);
        }

        HttpRequest request =
                HttpRequest.newBuilder(endpoint)
                        .timeout(requestTimeout)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(jsonMapper.writeValueAsBytes(body)))
                        .build();
        long startedNanos = System.nanoTime();
        CompletableFuture<HttpResponse<byte[]>> pending =
                client.sendAsync(
                        request,
                        info ->
                                new LimitedBodySubscriber(
                                        info.headers().firstValueAsLong("Content-Length"),
                                        maxResponseBytes));
        HttpResponse<byte[]> response;
        try {
            // HttpRequest.timeout은 응답 헤더까지만 보장하므로 본문 수신까지 전체 상한을 따로 건다.
            response = pending.get(requestTimeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException ex) {
            pending.cancel(true);
            return failed(courseId, startedNanos, "TIMEOUT");
        } catch (InterruptedException ex) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            return failed(courseId, startedNanos, "INTERRUPTED");
        } catch (ExecutionException ex) {
            return failed(courseId, startedNanos, transportReason(ex.getCause()));
        }

        int status = response.statusCode();
        if (status == 200) {
            try {
                Success success = parse(response.body());
                log.info(
                        "Route 바탕 지도 호출 성공 courseId={} elapsedMs={}",
                        courseId,
                        elapsedMs(startedNanos));
                return success;
            } catch (InvalidBasemapResponse ex) {
                // 사유는 계약 위반 종류만 남긴다(좌표 원문 없음).
                log.warn(
                        "Route 바탕 지도 응답 계약 위반 courseId={} elapsedMs={} detail={}",
                        courseId,
                        elapsedMs(startedNanos),
                        ex.getMessage());
                return new Failure("INVALID_RESPONSE");
            }
        }
        String code = errorCode(response.body());
        log.warn(
                "Route 바탕 지도 호출 실패 courseId={} status={} code={} elapsedMs={}",
                courseId,
                status,
                code,
                elapsedMs(startedNanos));
        if (status == 422 && "OUT_OF_AREA".equals(code)) {
            return new OutOfArea();
        }
        return new Failure("HTTP_" + status + (code == null ? "" : "_" + code));
    }

    /** 200 본문 검증. 그릴 지형지물과 기준 시각을 만든다. */
    private Success parse(byte[] body) {
        JsonNode root;
        try {
            root = jsonMapper.readTree(body);
        } catch (RuntimeException ex) {
            throw new InvalidBasemapResponse("본문 파싱 실패");
        }
        if (root == null || !root.isObject()) throw new InvalidBasemapResponse("객체 아님");

        JsonNode features = root.get("features");
        if (features == null || !features.isArray()) throw new InvalidBasemapResponse("features 없음");
        if (features.size() > MAX_FEATURES) throw new InvalidBasemapResponse("features 개수");
        JsonNode buildingsAvailable = root.get("buildings_available");
        if (buildingsAvailable == null || !buildingsAvailable.isBoolean()) {
            throw new InvalidBasemapResponse("buildings_available");
        }

        int[] coordinateBudget = {MAX_COORDINATES};
        List<BasemapFeature> parsed = new ArrayList<>(features.size());
        for (JsonNode feature : features) {
            parsed.add(feature(feature, coordinateBudget));
        }
        return new Success(
                parsed,
                timestamp(root.get("osm_data_timestamp")),
                buildingsAvailable.booleanValue(),
                timestamp(root.get("buildings_osm_data_timestamp")));
    }

    private static BasemapFeature feature(JsonNode feature, int[] coordinateBudget) {
        if (feature == null || !feature.isObject()) throw new InvalidBasemapResponse("feature 형식");
        JsonNode kindNode = feature.get("kind");
        Kind kind =
                kindNode != null && kindNode.isString() ? Kind.fromWire(kindNode.stringValue()) : null;
        if (kind == null) throw new InvalidBasemapResponse("kind");
        RoadClass roadClass = roadClass(kind, feature.get("road_class"));
        double height = height(kind, feature.get("height_m"));
        JsonNode geometry = feature.get("geometry");
        if (geometry == null || !geometry.isObject()) throw new InvalidBasemapResponse("geometry");
        JsonNode type = geometry.get("type");
        JsonNode coordinates = geometry.get("coordinates");
        if (type == null || !type.isString()) throw new InvalidBasemapResponse("geometry.type");
        return switch (type.stringValue()) {
            case "LineString" -> {
                if (kind == Kind.BUILDING) throw new InvalidBasemapResponse("building geometry");
                yield new BasemapFeature(
                        kind,
                        roadClass,
                        false,
                        List.of(positions(coordinates, 2, coordinateBudget)),
                        0);
            }
            case "Polygon" ->
                    new BasemapFeature(
                            kind, roadClass, true, rings(coordinates, coordinateBudget), height);
            default -> throw new InvalidBasemapResponse("geometry.type");
        };
    }

    /** 도로 등급. road에만 선택으로 허용하고 정해진 값만 받는다. 없거나 JSON null이면 null. */
    private static RoadClass roadClass(Kind kind, JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (kind != Kind.ROAD) throw new InvalidBasemapResponse("road_class 대상 아님");
        RoadClass roadClass = node.isString() ? RoadClass.fromWire(node.stringValue()) : null;
        if (roadClass == null) throw new InvalidBasemapResponse("road_class");
        return roadClass;
    }

    /**
     * 건물 높이(m). building에는 필수(0 이상 {@value #MAX_HEIGHT_M} 이하 유한수), 다른 kind에는 없거나 null이어야 한다.
     */
    private static double height(Kind kind, JsonNode node) {
        if (kind != Kind.BUILDING) {
            if (node != null && !node.isNull()) {
                throw new InvalidBasemapResponse("height_m 대상 아님");
            }
            return 0;
        }
        if (node == null || !node.isNumber()) throw new InvalidBasemapResponse("height_m");
        double value = node.doubleValue();
        if (!Double.isFinite(value) || value < 0 || value > MAX_HEIGHT_M) {
            throw new InvalidBasemapResponse("height_m 범위");
        }
        return value;
    }

    /** Polygon 좌표: 하나 이상의 고리, 각 고리는 4점 이상. */
    private static List<double[]> rings(JsonNode rings, int[] coordinateBudget) {
        if (rings == null || !rings.isArray() || rings.isEmpty()) {
            throw new InvalidBasemapResponse("polygon 고리");
        }
        List<double[]> clean = new ArrayList<>(rings.size());
        for (JsonNode ring : rings) {
            clean.add(positions(ring, 4, coordinateBudget));
        }
        return clean;
    }

    /**
     * [lon, lat] 좌표 배열을 [lon0, lat0, lon1, lat1, ...]로 만든다. 유한수·축 범위·최소 점 수·응답 전체 좌표 수 상한을 검사한다.
     */
    private static double[] positions(JsonNode positions, int minSize, int[] coordinateBudget) {
        if (positions == null || !positions.isArray() || positions.size() < minSize) {
            throw new InvalidBasemapResponse("좌표 점 수");
        }
        coordinateBudget[0] -= positions.size();
        if (coordinateBudget[0] < 0) throw new InvalidBasemapResponse("좌표 개수");
        double[] clean = new double[positions.size() * 2];
        int i = 0;
        for (JsonNode position : positions) {
            if (position == null || !position.isArray() || position.size() != 2) {
                throw new InvalidBasemapResponse("좌표 차원");
            }
            double lon = finite(position.get(0));
            double lat = finite(position.get(1));
            if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                throw new InvalidBasemapResponse("좌표 범위");
            }
            clean[i++] = lon;
            clean[i++] = lat;
        }
        return clean;
    }

    private static double finite(JsonNode node) {
        if (node == null || !node.isNumber()) throw new InvalidBasemapResponse("좌표 형식");
        double value = node.doubleValue();
        if (!Double.isFinite(value)) throw new InvalidBasemapResponse("좌표 유한수 아님");
        return value;
    }

    /** 기준 시각은 부가 정보라 없거나 해석할 수 없으면 null로 두고 지형지물은 저장한다. */
    private static Instant timestamp(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!node.isString()) {
            log.warn("Route 바탕 지도 osm_data_timestamp 형식이 문자열이 아니라 비움");
            return null;
        }
        try {
            return OffsetDateTime.parse(node.stringValue()).toInstant();
        } catch (DateTimeParseException ex) {
            log.warn("Route 바탕 지도 osm_data_timestamp를 해석하지 못해 비움");
            return null;
        }
    }

    private String errorCode(byte[] body) {
        try {
            JsonNode root = jsonMapper.readTree(body);
            JsonNode code = root == null ? null : root.get("code");
            if (code == null || !code.isString()) return null;
            String value = code.stringValue();
            return KNOWN_ERROR_CODES.contains(value) ? value : "UNKNOWN";
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static String transportReason(Throwable cause) {
        if (cause instanceof ResponseTooLarge) return "RESPONSE_TOO_LARGE";
        // HttpConnectTimeoutException은 HttpTimeoutException의 하위형이라 먼저 본다.
        if (cause instanceof HttpConnectTimeoutException) return "UNAVAILABLE";
        if (cause instanceof HttpTimeoutException) return "TIMEOUT";
        return "UNAVAILABLE";
    }

    private static Failure failed(long courseId, long startedNanos, String reason) {
        log.warn(
                "Route 바탕 지도 호출 실패 courseId={} reason={} elapsedMs={}",
                courseId,
                reason,
                elapsedMs(startedNanos));
        return new Failure(reason);
    }

    private static long elapsedMs(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }

    /** 응답 계약 위반. 사유 문자열에 좌표·원문을 넣지 않는다. */
    static final class InvalidBasemapResponse extends RuntimeException {
        InvalidBasemapResponse(String reason) {
            super(reason, null, false, false);
        }
    }

    /** 응답 본문 상한 초과. */
    static final class ResponseTooLarge extends IOException {
        ResponseTooLarge() {
            super("Route basemap response too large", null);
        }
    }

    /** 상한까지만 모으는 본문 구독자. 초과하면 구독을 취소한다. */
    static final class LimitedBodySubscriber implements BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        private final boolean declaredTooLarge;
        private final int maxBytes;
        private Flow.Subscription subscription;

        LimitedBodySubscriber(OptionalLong contentLength, int maxBytes) {
            this.maxBytes = maxBytes;
            this.declaredTooLarge =
                    contentLength.isPresent() && contentLength.getAsLong() > maxBytes;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            if (declaredTooLarge) {
                subscription.cancel();
                result.completeExceptionally(new ResponseTooLarge());
                return;
            }
            subscription.request(Long.MAX_VALUE);
        }

        @Override
        public void onNext(List<ByteBuffer> items) {
            if (result.isDone()) return;
            for (ByteBuffer item : items) {
                if (buffer.size() + (long) item.remaining() > maxBytes) {
                    subscription.cancel();
                    result.completeExceptionally(new ResponseTooLarge());
                    return;
                }
                byte[] chunk = new byte[item.remaining()];
                item.get(chunk);
                buffer.writeBytes(chunk);
            }
        }

        @Override
        public void onError(Throwable throwable) {
            result.completeExceptionally(throwable);
        }

        @Override
        public void onComplete() {
            result.complete(buffer.toByteArray());
        }
    }
}
