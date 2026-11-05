package com.runway.backend.infrastructure.ai;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;

/** 테스트용 가짜 AI 서버(JDK HttpServer). 루프백에서만 연다. 응답 본문은 받은 요청 본문으로 만들 수 있다. 모든 값은 합성 데이터다. */
public final class FakeAiServer implements AutoCloseable {

    public record Received(String method, String path, String contentType, String body) {}

    private final HttpServer server;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private volatile int status = 200;
    private volatile Function<String, String> body = request -> "{}";
    private volatile Duration delay = Duration.ZERO;
    private volatile Duration bodyStall = Duration.ZERO;

    public FakeAiServer() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
        server.setExecutor(executor);
        server.createContext(
                "/",
                exchange -> {
                    String requestBody =
                            new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    received.add(
                            new Received(
                                    exchange.getRequestMethod(),
                                    exchange.getRequestURI().getPath(),
                                    exchange.getRequestHeaders().getFirst("Content-Type"),
                                    requestBody));
                    try {
                        Thread.sleep(delay.toMillis());
                    } catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                    }
                    byte[] payload = body.apply(requestBody).getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    try {
                        if (bodyStall.isZero()) {
                            exchange.sendResponseHeaders(status, payload.length);
                            try (OutputStream out = exchange.getResponseBody()) {
                                out.write(payload);
                            }
                        } else {
                            // 헤더와 본문 첫 바이트만 보내고 멈춘다(chunked).
                            exchange.sendResponseHeaders(status, 0);
                            try (OutputStream out = exchange.getResponseBody()) {
                                out.write(payload, 0, 1);
                                out.flush();
                                Thread.sleep(bodyStall.toMillis());
                                out.write(payload, 1, payload.length - 1);
                            } catch (InterruptedException ex) {
                                Thread.currentThread().interrupt();
                            }
                        }
                    } catch (IOException ignored) {
                        // 클라이언트가 먼저 끊은 경우(시간 초과)다.
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
    }

    public URI baseUri() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }

    public FakeAiServer respond(int status, String json) {
        return respond(status, request -> json);
    }

    public FakeAiServer respond(int status, Function<String, String> body) {
        this.status = status;
        this.body = body;
        return this;
    }

    public FakeAiServer delay(Duration delay) {
        this.delay = delay;
        return this;
    }

    /** 헤더를 보낸 뒤 본문 전송을 이만큼 멈춘다. */
    public FakeAiServer stallBody(Duration stall) {
        this.bodyStall = stall;
        return this;
    }

    public List<Received> received() {
        return received;
    }

    public void reset() {
        received.clear();
        status = 200;
        body = request -> "{}";
        delay = Duration.ZERO;
        bodyStall = Duration.ZERO;
    }

    @Override
    public void close() {
        server.stop(0);
        executor.shutdownNow();
    }
}
