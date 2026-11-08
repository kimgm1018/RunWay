package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.coaching.decide.PaceDecideRequest;
import com.runway.backend.domain.coaching.decide.PaceDecider;
import com.runway.backend.domain.coaching.decide.PaceDecision;
import com.runway.backend.infrastructure.ai.PaceDecideResponseParser.InvalidResponse;

import lombok.extern.slf4j.Slf4j;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodySubscriber;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.OptionalLong;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * AI04 {@code POST /v1/pace/decide} HTTP 어댑터(ai-service.md AI04, S15P31E105-421).
 *
 * <ul>
 *   <li>연결 1초, 연결·헤더·본문 수신을 모두 포함한 전체 3초(N7-5) 안에 끝나지 않으면 포기하고 늦은 응답은 버린다. 헤더만 보내고 본문을
 *       멈춘 응답도 같은 기한에 끊는다(리뷰 A-1·B-1).
 *   <li>자동 재시도·redirect를 하지 않는다. 다음 W07 batch의 최신 입력에서 다시 판단한다(O14).
 *   <li>요청·응답 본문은 건강 측정값이므로 로그에 남기지 않는다. 로그에는 HTTP 상태·AI 오류 코드·실패 종류만 남긴다.
 * </ul>
 */
@Slf4j
public final class AiPaceDecideHttpClient implements PaceDecider {

    static final String DECIDE_PATH = "/v1/pace/decide";

    /** 응답 본문 상한. 정상 응답은 수 KB다. */
    static final int MAX_RESPONSE_BYTES = 256 * 1024;

    private final URI endpoint;
    private final HttpClient client;
    private final Duration requestTimeout;
    private final JsonMapper jsonMapper;
    private final PaceDecideResponseParser parser;

    public AiPaceDecideHttpClient(
            URI baseUri, Duration connectTimeout, Duration requestTimeout, JsonMapper jsonMapper) {
        this.endpoint = baseUri.resolve(DECIDE_PATH);
        this.client =
                HttpClient.newBuilder()
                        .connectTimeout(connectTimeout)
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .version(HttpClient.Version.HTTP_1_1)
                        .build();
        this.requestTimeout = requestTimeout;
        this.jsonMapper = jsonMapper;
        this.parser = new PaceDecideResponseParser(jsonMapper);
    }

    @Override
    public Optional<PaceDecision> decide(PaceDecideRequest request) {
        long started = System.nanoTime();
        HttpRequest httpRequest =
                HttpRequest.newBuilder(endpoint)
                        .timeout(requestTimeout)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(
                                jsonMapper.writeValueAsBytes(request)))
                        .build();
        // 본문까지 다 받아야 완료되는 핸들러라 아래 get의 기한이 본문 수신까지 덮는다.
        CompletableFuture<HttpResponse<byte[]>> pending =
                client.sendAsync(
                        httpRequest,
                        info -> new LimitedBodySubscriber(info.headers().firstValueAsLong("Content-Length")));
        HttpResponse<byte[]> response;
        try {
            response = pending.get(requestTimeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException ex) {
            pending.cancel(true);
            return failed("TIMEOUT", started);
        } catch (InterruptedException ex) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            return failed("INTERRUPTED", started);
        } catch (ExecutionException ex) {
            return failed(transportFailure(ex.getCause()), started);
        }

        byte[] body = response.body();
        int status = response.statusCode();
        if (status == 422) {
            // 입력 부족·오래됨(INPUT_INSUFFICIENT)은 러닝 초반·결측에서 정상적으로 반복되므로 경고로 남기지 않는다(리뷰 A-8).
            log.info("AI04 판단 불가 status=422 code={} elapsedMs={}", errorCode(body), elapsedMs(started));
            return Optional.empty();
        }
        if (status != 200) {
            log.warn(
                    "AI04 호출 실패 status={} code={} elapsedMs={}",
                    status,
                    errorCode(body),
                    elapsedMs(started));
            return Optional.empty();
        }
        try {
            Optional<PaceDecision> decision = parser.parse(body);
            log.debug(
                    "AI04 호출 성공 elapsedMs={} decision={}",
                    elapsedMs(started),
                    decision.map(d -> d.action().name()).orElse("NONE"));
            return decision;
        } catch (InvalidResponse ex) {
            log.warn(
                    "AI04 응답 계약 위반 field={} elapsedMs={}", ex.getMessage(), elapsedMs(started));
            return Optional.empty();
        }
    }

    private static String transportFailure(Throwable cause) {
        if (cause instanceof ResponseTooLarge) return "RESPONSE_TOO_LARGE";
        // HttpConnectTimeoutException은 HttpTimeoutException의 하위형이라 먼저 본다.
        if (cause instanceof HttpConnectTimeoutException) return "CONNECT_TIMEOUT";
        if (cause instanceof HttpTimeoutException) return "TIMEOUT";
        return "UNAVAILABLE";
    }

    /** AI 오류 본문의 code만 읽는다. message·details는 반사하지 않는다. 알 수 없으면 UNKNOWN. */
    private String errorCode(byte[] body) {
        try {
            JsonNode root = jsonMapper.readTree(body);
            JsonNode code = root == null ? null : root.get("code");
            if (code != null && code.isString() && code.stringValue().matches("[A-Z_]{1,40}")) {
                return code.stringValue();
            }
        } catch (RuntimeException ignored) {
            // 형식이 다른 오류 본문
        }
        return "UNKNOWN";
    }

    private static Optional<PaceDecision> failed(String reason, long started) {
        log.warn("AI04 호출 실패 reason={} elapsedMs={}", reason, elapsedMs(started));
        return Optional.empty();
    }

    private static long elapsedMs(long started) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    }

    static final class ResponseTooLarge extends RuntimeException {
        ResponseTooLarge() {
            super(null, null, false, false);
        }
    }

    /** 본문을 상한까지만 모은다. 선언·실제 크기가 상한을 넘으면 받기를 멈추고 실패한다. */
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
