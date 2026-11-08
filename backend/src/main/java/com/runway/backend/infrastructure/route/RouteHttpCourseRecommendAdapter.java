package com.runway.backend.infrastructure.route;

import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendFilters;
import com.runway.backend.domain.course.recommend.CourseRecommendPort;
import com.runway.backend.domain.course.recommend.CourseRecommendShape;
import com.runway.backend.domain.course.recommend.GeneratedCourses;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.infrastructure.route.RouteResponseParser.InvalidRouteResponse;

import lombok.extern.slf4j.Slf4j;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Route 내부 HTTP 어댑터(ai-service.md "Route 코스 생성 내부 HTTP 계약 초안", S15P31E105-423).
 *
 * <ul>
 *   <li>요청은 검증·정규화한 값만 snake_case로 보낸다. 사용자 ID·토큰·건강정보는 보내지 않는다.
 *   <li>연결을 포함한 전체 호출 상한(기본 15초)과 C01 전체 deadline 중 먼저 오는 시각에 포기하고 늦은 응답은 버린다.
 *   <li>본문은 256KB를 넘게 읽지 않는다. 자동 재시도·redirect·다른 생성기 전환은 하지 않는다.
 *   <li>오류는 허용 목록으로만 공개 사유에 매핑하고 상류 message·debug·details를 반사하지 않는다.
 * </ul>
 */
@Slf4j
public final class RouteHttpCourseRecommendAdapter implements CourseRecommendPort {

    static final String RECOMMEND_PATH = "/internal/v1/routes/recommendations";
    static final int MAX_RESPONSE_BYTES = 256 * 1024;

    /** Route가 계산을 시작하지 않을 시각(epoch ms) 헤더(ai/route_service/API.md 2절). */
    static final String DEADLINE_HEADER = "X-Request-Deadline";

    /**
     * 계산 시작에 필요한 남은 예산. 실측 최악 4.5초 + 여유(ai-service.md "Route 시간 예산·동시성과 재시도"). 우리 마감보다 이만큼
     * 앞선 시각을 보내 늦게 끝날 계산을 Route가 시작하지 않게 한다.
     */
    static final Duration START_BUDGET = Duration.ofSeconds(6);

    private final URI endpoint;
    private final HttpClient client;
    private final Duration requestTimeout;
    private final JsonMapper jsonMapper;
    private final RouteResponseParser parser;
    private final Clock clock;

    /**
     * @param baseUri Route origin. null이면 설정 누락으로 보고 매 호출을 {@code ROUTE_UNAVAILABLE}로 실패시킨다
     */
    public RouteHttpCourseRecommendAdapter(
            URI baseUri,
            Duration connectTimeout,
            Duration requestTimeout,
            JsonMapper jsonMapper,
            Clock clock) {
        this.endpoint = baseUri == null ? null : baseUri.resolve(RECOMMEND_PATH);
        this.client =
                HttpClient.newBuilder()
                        .connectTimeout(connectTimeout)
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .version(HttpClient.Version.HTTP_1_1)
                        .build();
        this.requestTimeout = requestTimeout;
        this.jsonMapper = jsonMapper;
        this.parser = new RouteResponseParser(jsonMapper);
        this.clock = clock;
    }

    @Override
    public GeneratedCourses recommend(CourseRecommendCommand command, Instant deadline) {
        if (endpoint == null) {
            log.warn("Route 호출 실패 reason=ROUTE_UNAVAILABLE cause=base-url-missing");
            throw failure(ErrorCode.COURSE_ROUTE_UNAVAILABLE, "ROUTE_UNAVAILABLE");
        }
        Instant start = clock.instant();
        Instant routeDeadline = start.plus(requestTimeout);
        boolean overallFirst = deadline.isBefore(routeDeadline);
        Instant effectiveDeadline = overallFirst ? deadline : routeDeadline;
        Duration remaining = Duration.between(start, effectiveDeadline);
        if (remaining.isNegative() || remaining.isZero()) {
            throw timeout(overallFirst);
        }
        long startBy = effectiveDeadline.minus(START_BUDGET).toEpochMilli();

        HttpRequest request =
                HttpRequest.newBuilder(endpoint)
                        .timeout(remaining)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .header(DEADLINE_HEADER, Long.toString(startBy))
                        .POST(HttpRequest.BodyPublishers.ofByteArray(requestBody(command)))
                        .build();
        long startedNanos = System.nanoTime();
        CompletableFuture<HttpResponse<byte[]>> pending =
                client.sendAsync(request, info -> new LimitedBodySubscriber(info.headers()
                        .firstValueAsLong("Content-Length")));
        HttpResponse<byte[]> response;
        try {
            response = pending.get(remaining.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException ex) {
            pending.cancel(true);
            throw logged(timeout(overallFirst), startedNanos, "deadline");
        } catch (InterruptedException ex) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw logged(unavailable(), startedNanos, "interrupted");
        } catch (ExecutionException ex) {
            throw logged(fromTransportFailure(ex.getCause(), overallFirst), startedNanos, "transport");
        }

        int status = response.statusCode();
        if (status == 200) {
            try {
                GeneratedCourses generated = parser.parse(response.body(), command);
                log.info(
                        "Route 호출 성공 status=200 elapsedMs={} candidates={}",
                        elapsedMs(startedNanos),
                        generated.courses().size());
                return generated;
            } catch (InvalidRouteResponse ex) {
                // 사유는 계약 위반 종류만 남긴다(좌표·문구 원문 없음).
                log.warn(
                        "Route 응답 계약 위반 reason=ROUTE_INVALID_RESPONSE elapsedMs={} detail={}",
                        elapsedMs(startedNanos),
                        ex.getMessage());
                throw invalidResponse();
            }
        }
        ApiException mapped = fromErrorResponse(status, response.body());
        log.warn(
                "Route 호출 실패 status={} elapsedMs={} reason={}",
                status,
                elapsedMs(startedNanos),
                mapped.details().get("reason"));
        throw mapped;
    }

    private byte[] requestBody(CourseRecommendCommand command) {
        CourseRecommendFilters filters = command.filters();
        Map<String, Object> filterBody = new LinkedHashMap<>();
        filterBody.put("river", filters.river());
        filterBody.put("beach", filters.beach());
        filterBody.put("park", filters.park());
        filterBody.put("trail", filters.trail());
        filterBody.put("pedestrian", filters.pedestrian());
        filterBody.put("avoid_major_road", filters.avoidMajorRoad());
        filterBody.put("avoid_steps", filters.avoidSteps());
        filterBody.put("avoid_tunnel", filters.avoidTunnel());
        filterBody.put("flat", filters.flat());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("lat", command.latitude());
        body.put("lon", command.longitude());
        body.put("distance_km", command.distanceKm());
        body.put("shape", command.shape().wireValue());
        // 편도에서만 도착 좌표를 보낸다. 다른 shape에 함께 온 도착 좌표는 C01 계약대로 무시한다.
        if (command.shape() == CourseRecommendShape.POINT_TO_POINT) {
            body.put("end_lat", command.endLatitude());
            body.put("end_lon", command.endLongitude());
        }
        body.put("seed", command.seed());
        body.put("filters", filterBody);
        return jsonMapper.writeValueAsBytes(body);
    }

    /** ai-service.md "Route 오류 매핑" 표. 허용 목록에 없는 조합은 상류 계약 오류다. */
    private ApiException fromErrorResponse(int status, byte[] body) {
        String code = errorCode(body);
        if (code == null) return invalidResponse();
        return switch (status) {
            case 422 ->
                    switch (code) {
                        case "OUT_OF_AREA" ->
                                failure(ErrorCode.SEARCH_OUT_OF_AREA, "OUT_OF_AREA");
                        case "OUT_OF_APP_RANGE" ->
                                failure(ErrorCode.SEARCH_OUT_OF_APP_RANGE, "OUT_OF_APP_RANGE");
                        case "NO_ROAD_NEARBY" ->
                                failure(ErrorCode.SEARCH_NO_ROAD_NEARBY, "NO_ROAD_NEARBY");
                        case "DESTINATION_TOO_FAR" ->
                                failure(ErrorCode.SEARCH_DESTINATION_TOO_FAR, "DESTINATION_TOO_FAR");
                        case "END_SNAP_PE1", "END_SNAP_PE2", "END_SNAP_PE4", "END_SNAP_PE5" ->
                                failure(ErrorCode.SEARCH_DESTINATION_NO_ROAD_NEARBY, "NO_ROAD_NEARBY");
                        case "NO_ROUTE", "USABILITY_GATE_ALL_FAILED" ->
                                failure(ErrorCode.SEARCH_NO_ROUTE, "NO_ROUTE");
                        default -> invalidResponse();
                    };
            case 503 ->
                    switch (code) {
                        case "NOT_READY" ->
                                failure(ErrorCode.COURSE_ROUTE_NOT_READY, "ROUTE_NOT_READY");
                        case "BUSY" -> failure(ErrorCode.COURSE_ROUTE_BUSY, "ROUTE_BUSY");
                        case "TIMEOUT" -> failure(ErrorCode.COURSE_ROUTE_TIMEOUT, "ROUTE_TIMEOUT");
                        case "UNAVAILABLE" -> unavailable();
                        default -> invalidResponse();
                    };
            case 500 ->
                    switch (code) {
                        case "INTERNAL", "SAFETY_CHECK", "SNAP_NODE_NOT_IN_GENERATION_GRAPH" ->
                                unavailable();
                        default -> invalidResponse();
                    };
            default -> invalidResponse();
        };
    }

    private String errorCode(byte[] body) {
        try {
            JsonNode root = jsonMapper.readTree(body);
            JsonNode code = root == null ? null : root.get("code");
            return code != null && code.isString() ? code.stringValue() : null;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static ApiException fromTransportFailure(Throwable cause, boolean overallFirst) {
        if (cause instanceof ResponseTooLarge) return invalidResponse();
        // 연결 1초 초과는 연결 실패다. HttpConnectTimeoutException은 HttpTimeoutException의 하위형이라 먼저 본다.
        if (cause instanceof HttpConnectTimeoutException) return unavailable();
        if (cause instanceof HttpTimeoutException) return timeout(overallFirst);
        if (cause instanceof IOException) return unavailable();
        return unavailable();
    }

    private static ApiException timeout(boolean overallFirst) {
        return overallFirst
                ? failure(ErrorCode.COURSE_GENERATION_TIMEOUT, "GENERATION_TIMEOUT")
                : failure(ErrorCode.COURSE_ROUTE_TIMEOUT, "ROUTE_TIMEOUT");
    }

    private static ApiException unavailable() {
        return failure(ErrorCode.COURSE_ROUTE_UNAVAILABLE, "ROUTE_UNAVAILABLE");
    }

    private static ApiException invalidResponse() {
        return failure(ErrorCode.COURSE_ROUTE_UNAVAILABLE, "ROUTE_INVALID_RESPONSE");
    }

    private static ApiException failure(ErrorCode errorCode, String reason) {
        return new ApiException(errorCode, Map.of("reason", reason));
    }

    private static ApiException logged(ApiException exception, long startedNanos, String cause) {
        log.warn(
                "Route 호출 실패 elapsedMs={} reason={} cause={}",
                elapsedMs(startedNanos),
                exception.details().get("reason"),
                cause);
        return exception;
    }

    private static long elapsedMs(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }

    /** 응답 본문 상한 초과. 무제한 버퍼링을 막기 위해 읽기를 중단한다. */
    static final class ResponseTooLarge extends IOException {
        ResponseTooLarge() {
            super("Route response too large", null);
        }
    }

    /** {@link #MAX_RESPONSE_BYTES}까지만 모으는 본문 구독자. 초과하면 구독을 취소한다. */
    static final class LimitedBodySubscriber implements BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        private final boolean declaredTooLarge;
        private Flow.Subscription subscription;

        LimitedBodySubscriber(OptionalLong contentLength) {
            this.declaredTooLarge =
                    contentLength.isPresent() && contentLength.getAsLong() > MAX_RESPONSE_BYTES;
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
                if (buffer.size() + (long) item.remaining() > MAX_RESPONSE_BYTES) {
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
