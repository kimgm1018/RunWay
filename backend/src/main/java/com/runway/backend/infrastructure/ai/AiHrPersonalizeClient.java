package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.personalization.Ai06PersonalizeRequest;
import com.runway.backend.domain.user.personalization.HrPersonalizePort;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult.Reason;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodySubscriber;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.OptionalLong;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI06 {@code POST {base}/v1/hr/personalize} 클라이언트(ai-service.md AI06, S15P31E105-410).
 *
 * <ul>
 *   <li>{@code 503 AI_BUSY}만 {@code Retry-After}(상한 적용)만큼 기다렸다가 최대 {@code maxRetries}번 다시 보낸다. 전송 오류·타임아웃·그 밖의
 *       상태는 재시도하지 않는다.
 *   <li>{@code 422 INPUT_INSUFFICIENT}는 {@link HrPersonalizeResult.InputInsufficient}, 2xx만 {@link
 *       HrPersonalizeResult.Success}다.
 *   <li>응답 본문은 {@value #MAX_RESPONSE_BYTES}바이트까지만 읽는다. redirect는 따르지 않는다.
 *   <li>요청·응답 본문과 심박 값은 로그에 남기지 않는다(상태·소요시간·사유 코드만).
 * </ul>
 *
 * 호출은 호출 스레드를 막는 동기 방식이며 호출자는 트랜잭션 밖에서 부른다.
 */
public final class AiHrPersonalizeClient implements HrPersonalizePort {

    static final String PATH = "/v1/hr/personalize";
    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    /** {@code Retry-After}가 없거나 해석할 수 없을 때 기다리는 시간. */
    static final Duration DEFAULT_RETRY_AFTER = Duration.ofSeconds(1);

    private static final Logger log = LoggerFactory.getLogger(AiHrPersonalizeClient.class);

    private final URI endpoint;
    private final HttpClient client;
    private final Duration requestTimeout;
    private final int maxRetries;
    private final Duration maxRetryAfter;
    private final JsonMapper jsonMapper;

    /**
     * @param baseUri AI origin. null이면 설정 누락으로 보고 매 호출을 {@code UNAVAILABLE}로 실패시킨다
     */
    public AiHrPersonalizeClient(
            HttpClient client,
            URI baseUri,
            Duration requestTimeout,
            int maxRetries,
            Duration maxRetryAfter,
            JsonMapper jsonMapper) {
        this.endpoint = baseUri == null ? null : baseUri.resolve(PATH);
        this.client = client;
        this.requestTimeout = requestTimeout;
        this.maxRetries = Math.max(0, maxRetries);
        this.maxRetryAfter = maxRetryAfter;
        this.jsonMapper = jsonMapper;
    }

    @Override
    public HrPersonalizeResult personalize(Ai06PersonalizeRequest request) {
        if (endpoint == null) {
            log.warn("AI06 호출 실패 reason=UNAVAILABLE cause=base-url-missing");
            return new HrPersonalizeResult.Failure(Reason.UNAVAILABLE, 0);
        }
        byte[] body;
        try {
            body = jsonMapper.writeValueAsBytes(request);
        } catch (JacksonException ex) {
            log.error("AI06 요청 직렬화 실패 {}", ex.getClass().getSimpleName());
            return new HrPersonalizeResult.Failure(Reason.INTERNAL, 0);
        }

        for (int attempt = 0; ; attempt++) {
            long startedNanos = System.nanoTime();
            HttpResponse<byte[]> response;
            try {
                response = send(body);
            } catch (CallFailure failure) {
                log.warn(
                        "AI06 호출 실패 reason={} attempt={} elapsedMs={}",
                        failure.reason,
                        attempt,
                        elapsedMs(startedNanos));
                return new HrPersonalizeResult.Failure(failure.reason, 0);
            }

            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                HrPersonalizeResult mapped = mapSuccess(response.body(), request.userId());
                log.info(
                        "AI06 호출 완료 status={} attempt={} elapsedMs={} result={}",
                        status,
                        attempt,
                        elapsedMs(startedNanos),
                        mapped.getClass().getSimpleName());
                return mapped;
            }

            String code = errorCode(response.body());
            if (status == 422 && "INPUT_INSUFFICIENT".equals(code)) {
                log.info(
                        "AI06 입력 부족 status=422 attempt={} elapsedMs={}",
                        attempt,
                        elapsedMs(startedNanos));
                return new HrPersonalizeResult.InputInsufficient();
            }
            if (status == 503 && "AI_BUSY".equals(code)) {
                if (attempt >= maxRetries) {
                    log.warn("AI06 AI_BUSY 재시도 소진 attempts={}", attempt + 1);
                    return new HrPersonalizeResult.Failure(Reason.BUSY_RETRIES_EXHAUSTED, status);
                }
                Duration wait = retryDelay(response.headers());
                log.info(
                        "AI06 AI_BUSY 재시도 대기 attempt={} waitMs={}", attempt, wait.toMillis());
                if (!sleep(wait)) {
                    return new HrPersonalizeResult.Failure(Reason.INTERNAL, status);
                }
                continue;
            }
            log.warn(
                    "AI06 호출 실패 reason=HTTP_ERROR status={} attempt={} elapsedMs={}",
                    status,
                    attempt,
                    elapsedMs(startedNanos));
            return new HrPersonalizeResult.Failure(Reason.HTTP_ERROR, status);
        }
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
                                new LimitedBodySubscriber(
                                        info.headers().firstValueAsLong("Content-Length")));
        try {
            // HttpRequest.timeout은 응답 헤더까지만 보장하므로 본문 수신까지 전체 상한을 따로 건다.
            return pending.get(requestTimeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException ex) {
            pending.cancel(true);
            throw new CallFailure(Reason.TIMEOUT);
        } catch (InterruptedException ex) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new CallFailure(Reason.INTERNAL);
        } catch (ExecutionException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof ResponseTooLarge) throw new CallFailure(Reason.INVALID_RESPONSE);
            // HttpConnectTimeoutException은 HttpTimeoutException의 하위형이라 먼저 본다.
            if (cause instanceof HttpConnectTimeoutException) {
                throw new CallFailure(Reason.UNAVAILABLE);
            }
            if (cause instanceof HttpTimeoutException) throw new CallFailure(Reason.TIMEOUT);
            throw new CallFailure(Reason.UNAVAILABLE);
        }
    }

    /** 2xx 본문을 저장 값으로 매핑한다. gruPersonalization·warnings·createdAt은 읽지 않는다. */
    private HrPersonalizeResult mapSuccess(byte[] body, long expectedUserId) {
        try {
            JsonNode root = jsonMapper.readTree(body);
            if (root == null || !root.isObject()) return invalid("not-object");

            JsonNode userId = root.get("userId");
            if (userId == null
                    || !userId.isIntegralNumber()
                    || !userId.canConvertToLong()
                    || userId.longValue() != expectedUserId) {
                return invalid("user-id");
            }
            String schemaVersion = requiredText(root, "schemaVersion");
            String modelVersion = requiredText(root, "modelVersion");
            Integer supportRunCount = optionalInt(root, "supportRunCount");
            JsonNode summaryU = root.get("summaryU");
            JsonNode history8 = root.get("history8");
            JsonNode p4 = root.get("p4");
            BigDecimal hr0Sub = optionalDecimal(root, "hr0SubBpm");
            if (schemaVersion == null
                    || modelVersion == null
                    || supportRunCount == null
                    || hr0Sub == null
                    || summaryU == null
                    || !summaryU.isObject()
                    || history8 == null
                    || !history8.isArray()
                    || p4 == null
                    || !p4.isArray()) {
                return invalid("required-field");
            }
            HrPersonalizationCommand command =
                    new HrPersonalizationCommand(
                            schemaVersion,
                            modelVersion,
                            supportRunCount,
                            jsonMapper.writeValueAsString(summaryU),
                            jsonMapper.writeValueAsString(history8),
                            jsonMapper.writeValueAsString(p4),
                            hr0Sub,
                            optionalDecimal(root, "hrRefBpm"),
                            optionalDecimal(root, "hrDangerBpm"),
                            optionalDecimal(root, "hrSustainBpm"),
                            optionalInt(root, "hrThresholdRunCount"));
            return new HrPersonalizeResult.Success(command);
        } catch (JacksonException ex) {
            return invalid("json");
        }
    }

    private static HrPersonalizeResult invalid(String detail) {
        // 어느 계약 항목이 어긋났는지만 남긴다(값 없음).
        log.warn("AI06 응답 계약 위반 reason=INVALID_RESPONSE detail={}", detail);
        return new HrPersonalizeResult.Failure(Reason.INVALID_RESPONSE, 0);
    }

    private static String requiredText(JsonNode root, String field) {
        JsonNode node = root.get(field);
        if (node == null || !node.isString() || node.stringValue().isBlank()) return null;
        return node.stringValue();
    }

    private static Integer optionalInt(JsonNode root, String field) {
        JsonNode node = root.get(field);
        if (node == null || !node.isIntegralNumber() || !node.canConvertToInt()) return null;
        return node.intValue();
    }

    private static BigDecimal optionalDecimal(JsonNode root, String field) {
        JsonNode node = root.get(field);
        return node == null || !node.isNumber() ? null : node.decimalValue();
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

    /** {@code Retry-After}(초 또는 HTTP-date)를 상한 안으로 맞춘다. 없거나 해석 못 하면 기본값. */
    Duration retryDelay(HttpHeaders headers) {
        Duration wait = headers.firstValue("Retry-After").map(AiHrPersonalizeClient::parseRetryAfter)
                .orElse(DEFAULT_RETRY_AFTER);
        if (wait.isNegative()) wait = Duration.ZERO;
        return wait.compareTo(maxRetryAfter) > 0 ? maxRetryAfter : wait;
    }

    private static Duration parseRetryAfter(String raw) {
        String value = raw.trim();
        try {
            return Duration.ofSeconds(Long.parseLong(value));
        } catch (NumberFormatException ignored) {
            // HTTP-date 형식을 시도한다.
        }
        try {
            ZonedDateTime date = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME);
            return Duration.between(ZonedDateTime.now(date.getZone()), date);
        } catch (DateTimeParseException ex) {
            return DEFAULT_RETRY_AFTER;
        }
    }

    private static boolean sleep(Duration wait) {
        if (wait.isZero()) return true;
        try {
            Thread.sleep(wait.toMillis());
            return true;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static long elapsedMs(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }

    /** 응답을 받기 전 실패. 사유만 담는다. */
    private static final class CallFailure extends Exception {
        private final Reason reason;

        CallFailure(Reason reason) {
            super(reason.name(), null, false, false);
            this.reason = reason;
        }
    }

    /** 응답 본문 상한 초과. 무제한 버퍼링을 막기 위해 읽기를 중단한다. */
    static final class ResponseTooLarge extends IOException {
        ResponseTooLarge() {
            super("AI response too large", null);
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
