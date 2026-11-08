package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.session.difficulty.CourseDifficultyPort;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * AI05 {@code POST {base}/v1/pace/plan} 클라이언트. 코스 지형 기준 구간 난이도 비율({@code segmentDifficultyRatios})만 읽는다
 * (ai-service.md AI05, S15P31E105-297).
 *
 * <ul>
 *   <li>요청은 {@code courseId}, 저장 경사 {@code gradeProfile}, 기준 {@code targetPaceSecPerKm}={@value #REFERENCE_PACE_SEC_PER_KM}이다.
 *       비율은 목표와 무관한 지형 값이며 기준 페이스는 AI05의 필수 pace 기준을 채우는 값이다. {@code userId}는 보내지 않는다.
 *   <li>재시도하지 않는다. 2xx가 아니거나 전송 오류·시간 초과·형식 위반이면 빈 값이다.
 *   <li>응답 본문은 {@value AiHrPersonalizeClient#MAX_RESPONSE_BYTES}바이트까지만 읽는다. redirect는 따르지 않는다.
 *   <li>요청·응답 본문은 로그에 남기지 않는다(상태·소요시간·사유만).
 * </ul>
 *
 * 호출은 호출 스레드를 막는 동기 방식이며 호출자는 트랜잭션·세션 잠금 밖에서 부른다.
 */
public final class AiPacePlanClient implements CourseDifficultyPort {

    static final String PATH = "/v1/pace/plan";
    static final int REFERENCE_PACE_SEC_PER_KM = 360;

    private static final Logger log = LoggerFactory.getLogger(AiPacePlanClient.class);

    private final URI endpoint;
    private final HttpClient client;
    private final Duration requestTimeout;
    private final JsonMapper jsonMapper;

    /**
     * @param baseUri AI origin. null이면 설정 누락으로 보고 매 호출을 빈 값으로 끝낸다
     */
    public AiPacePlanClient(
            HttpClient client, URI baseUri, Duration requestTimeout, JsonMapper jsonMapper) {
        this.endpoint = baseUri == null ? null : baseUri.resolve(PATH);
        this.client = client;
        this.requestTimeout = requestTimeout;
        this.jsonMapper = jsonMapper;
    }

    @Override
    public Optional<CourseDifficulty> segmentDifficulty(long courseId, String gradeProfileJson) {
        if (endpoint == null) {
            log.debug("AI05 호출 생략 reason=base-url-missing courseId={}", courseId);
            return Optional.empty();
        }
        byte[] body;
        try {
            ObjectNode request = jsonMapper.createObjectNode();
            request.put("courseId", courseId);
            request.set("gradeProfile", jsonMapper.readTree(gradeProfileJson));
            request.put("targetPaceSecPerKm", REFERENCE_PACE_SEC_PER_KM);
            body = jsonMapper.writeValueAsBytes(request);
        } catch (JacksonException ex) {
            log.warn("AI05 요청 생성 실패 courseId={} {}", courseId, ex.getClass().getSimpleName());
            return Optional.empty();
        }

        long startedNanos = System.nanoTime();
        HttpResponse<byte[]> response;
        try {
            response = send(body);
        } catch (CallFailure failure) {
            log.warn(
                    "AI05 호출 실패 reason={} courseId={} elapsedMs={}",
                    failure.getMessage(),
                    courseId,
                    elapsedMs(startedNanos));
            return Optional.empty();
        }
        int status = response.statusCode();
        if (status < 200 || status >= 300) {
            log.warn(
                    "AI05 호출 실패 reason=HTTP_ERROR status={} code={} courseId={} elapsedMs={}",
                    status,
                    errorCode(response.body()),
                    courseId,
                    elapsedMs(startedNanos));
            return Optional.empty();
        }
        Optional<CourseDifficulty> mapped = mapSuccess(response.body());
        log.info(
                "AI05 호출 완료 status={} courseId={} elapsedMs={} parsed={}",
                status,
                courseId,
                elapsedMs(startedNanos),
                mapped.isPresent());
        return mapped;
    }

    private HttpResponse<byte[]> send(byte[] body) throws CallFailure {
        HttpRequest request =
                HttpRequest.newBuilder(endpoint)
                        .timeout(requestTimeout)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                        .build();
        CompletableFuture<HttpResponse<byte[]>> pending =
                client.sendAsync(
                        request,
                        info ->
                                new AiHrPersonalizeClient.LimitedBodySubscriber(
                                        info.headers().firstValueAsLong("Content-Length")));
        try {
            // HttpRequest.timeout은 응답 헤더까지만 보장하므로 본문 수신까지 전체 상한을 따로 건다.
            return pending.get(requestTimeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException ex) {
            pending.cancel(true);
            throw new CallFailure("TIMEOUT");
        } catch (InterruptedException ex) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new CallFailure("INTERRUPTED");
        } catch (ExecutionException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof AiHrPersonalizeClient.ResponseTooLarge) {
                throw new CallFailure("RESPONSE_TOO_LARGE");
            }
            // HttpConnectTimeoutException은 HttpTimeoutException의 하위형이라 먼저 본다.
            if (cause instanceof HttpConnectTimeoutException) throw new CallFailure("UNAVAILABLE");
            if (cause instanceof HttpTimeoutException) throw new CallFailure("TIMEOUT");
            throw new CallFailure("UNAVAILABLE");
        }
    }

    /** 2xx 본문에서 plannerVersion, segmentDifficultyRatios, warnings[].code만 읽는다. 개수·양수·경고 판단은 호출자가 한다. */
    private Optional<CourseDifficulty> mapSuccess(byte[] body) {
        try {
            JsonNode root = jsonMapper.readTree(body);
            if (root == null || !root.isObject()) return invalid("not-object");
            JsonNode version = root.get("plannerVersion");
            if (version == null || !version.isString() || version.stringValue().isBlank()) {
                return invalid("planner-version");
            }
            JsonNode ratios = root.get("segmentDifficultyRatios");
            if (ratios == null || !ratios.isArray()) return invalid("ratios");
            List<BigDecimal> values = new ArrayList<>(ratios.size());
            for (JsonNode ratio : ratios) {
                if (!ratio.isNumber()) return invalid("ratio-type");
                values.add(ratio.decimalValue());
            }
            List<String> warningCodes = new ArrayList<>();
            JsonNode warnings = root.get("warnings");
            if (warnings != null && warnings.isArray()) {
                for (JsonNode warning : warnings) {
                    JsonNode code = warning.isObject() ? warning.get("code") : null;
                    if (code != null && code.isString()) warningCodes.add(code.stringValue());
                }
            }
            return Optional.of(new CourseDifficulty(version.stringValue(), values, warningCodes));
        } catch (JacksonException | NumberFormatException ex) {
            return invalid("json");
        }
    }

    private static Optional<CourseDifficulty> invalid(String detail) {
        log.warn("AI05 응답 계약 위반 reason=INVALID_RESPONSE detail={}", detail);
        return Optional.empty();
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

    private static long elapsedMs(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }

    /** 응답을 받기 전 실패. 사유만 담는다. */
    private static final class CallFailure extends Exception {
        CallFailure(String reason) {
            super(reason, null, false, false);
        }
    }
}
