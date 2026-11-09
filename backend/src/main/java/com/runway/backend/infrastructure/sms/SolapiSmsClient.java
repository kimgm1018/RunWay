package com.runway.backend.infrastructure.sms;

import com.runway.backend.domain.auth.verification.SmsPort;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * SOLAPI 문자 발송(S15P31E105-560). 공식 SDK의 발송과 같은 {@code POST /messages/v4/send-many/fast}에 1건을 보낸다.
 *
 * <p>공급자에 중복 방지 키가 없으므로 한 번만 시도한다. 전체 응답(본문 포함)을 {@code timeout} 안에 받지 못하면 결과 불명확이다.
 * 전화번호·문구·키·응답 본문을 로그와 예외에 남기지 않고 결과 종류와 HTTP 상태만 기록한다.
 */
@Slf4j
public final class SolapiSmsClient implements SmsPort {
    static final int MAX_BYTES = 64 * 1024;
    private static final URI ENDPOINT = URI.create("https://api.solapi.com/messages/v4/send-many/fast");

    private final SmsProperties properties;
    private final JsonMapper mapper;
    private final HttpClient client;
    private final URI endpoint;
    private final Duration timeout;
    private final Clock clock;
    private final SecureRandom random;

    public SolapiSmsClient(SmsProperties properties, JsonMapper mapper) {
        this(properties, mapper, ENDPOINT, Duration.ofSeconds(5), Clock.systemDefaultZone(), new SecureRandom());
    }

    // 주소·시각·난수 교체는 동일 패키지의 합성 HTTP 테스트에만 사용한다. 운영 주소는 고정한다.
    SolapiSmsClient(SmsProperties properties, JsonMapper mapper, URI endpoint, Duration timeout,
            Clock clock, SecureRandom random) {
        this.properties = properties;
        this.mapper = mapper;
        this.endpoint = endpoint;
        this.timeout = timeout;
        this.clock = clock;
        this.random = random;
        this.client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(1))
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    @Override
    public boolean enabled() {
        return properties.isEnabled();
    }

    @Override
    public Result send(String to, String text) {
        if (!properties.isEnabled()) return Result.REJECTED;
        var solapi = properties.getSolapi();
        HttpRequest request;
        try {
            byte[] body = mapper.writeValueAsBytes(Map.of(
                    "messages", List.of(Map.of("to", to, "from", solapi.getSenderNumber(), "text", text))));
            String authorization = SolapiSignature.authorization(
                    solapi.getApiKey(), solapi.getApiSecret(),
                    SolapiSignature.date(clock), SolapiSignature.salt(random));
            request = HttpRequest.newBuilder(endpoint)
                    .timeout(timeout)
                    .header("Authorization", authorization)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
        } catch (RuntimeException e) {
            // 보내기 전 실패(본문·서명·헤더 생성)라 발송되지 않았다. 예외 메시지에 키·번호가 있을 수 있어 남기지 않는다(리뷰 R-9).
            log.warn("SMS 요청을 만들지 못했습니다.");
            return Result.REJECTED;
        }
        CompletableFuture<HttpResponse<byte[]>> future = null;
        HttpResponse<byte[]> answer;
        try {
            future = client.sendAsync(request, ignored -> new LimitedBody());
            answer = future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return unknown("interrupted", 0);
        } catch (TimeoutException e) {
            return unknown("timeout", 0);
        } catch (ExecutionException | RuntimeException e) {
            // 연결 끊김·본문 초과 등: 공급자가 접수했을 수 있다.
            return unknown("io", 0);
        } finally {
            if (future != null && !future.isDone()) future.cancel(true);
        }
        int status = answer.statusCode();
        if (status >= 400 && status < 500) {
            log.warn("SMS 발송 거절 status={}", status);
            return Result.REJECTED;
        }
        if (status < 200 || status >= 300) {
            return unknown("status", status);
        }
        try {
            JsonNode failed = mapper.readTree(answer.body()).get("failedMessageList");
            if (failed != null && failed.isArray() && !failed.isEmpty()) {
                log.warn("SMS 발송 거절 status={} failedMessages={}", status, failed.size());
                return Result.REJECTED;
            }
            return Result.ACCEPTED;
        } catch (RuntimeException e) {
            return unknown("unreadable-body", status);
        }
    }

    private static Result unknown(String reason, int status) {
        log.warn("SMS 발송 결과 불명확 reason={} status={}", reason, status);
        return Result.UNKNOWN;
    }

    /** 응답 본문을 {@link #MAX_BYTES}까지만 받는다. 넘으면 결과 불명확으로 처리한다. */
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private long size;
        private boolean failed;

        @Override
        public CompletionStage<byte[]> getBody() {
            return delegate.getBody();
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            delegate.onSubscribe(subscription);
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            if (failed) return;
            for (ByteBuffer buffer : buffers) size += buffer.remaining();
            if (size > MAX_BYTES) {
                failed = true;
                subscription.cancel();
                delegate.onError(new IOException("response too large"));
            } else {
                delegate.onNext(buffers);
            }
        }

        @Override
        public void onError(Throwable error) {
            if (!failed) delegate.onError(new IOException("response failed"));
        }

        @Override
        public void onComplete() {
            if (!failed) delegate.onComplete();
        }
    }
}
