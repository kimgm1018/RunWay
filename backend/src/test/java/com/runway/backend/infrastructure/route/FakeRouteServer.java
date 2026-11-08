package com.runway.backend.infrastructure.route;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 테스트용 가짜 Route 서버(JDK HttpServer). 외부 네트워크 없이 루프백에서만 연다. */
public final class FakeRouteServer implements AutoCloseable {

    /** 받은 요청 한 건. 헤더 이름은 소문자로 둔다. */
    public record Received(String method, String path, Map<String, List<String>> headers, String body) {}

    private final HttpServer server;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private volatile int status = 200;
    private volatile byte[] body = new byte[0];
    private volatile Duration delay = Duration.ZERO;
    private volatile boolean chunked;

    public FakeRouteServer() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
        server.setExecutor(executor);
        server.createContext(
                "/",
                exchange -> {
                    var headers = new java.util.TreeMap<String, List<String>>();
                    exchange.getRequestHeaders()
                            .forEach((name, values) -> headers.put(name.toLowerCase(), values));
                    received.add(
                            new Received(
                                    exchange.getRequestMethod(),
                                    exchange.getRequestURI().getPath(),
                                    headers,
                                    new String(
                                            exchange.getRequestBody().readAllBytes(),
                                            StandardCharsets.UTF_8)));
                    try {
                        Thread.sleep(delay.toMillis());
                    } catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                    }
                    byte[] payload = body;
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    try {
                        exchange.sendResponseHeaders(status, chunked ? 0 : payload.length);
                        try (OutputStream out = exchange.getResponseBody()) {
                            out.write(payload);
                        }
                    } catch (IOException ignored) {
                        // 클라이언트가 먼저 끊은 경우(시간 초과·본문 상한)다.
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
    }

    public URI baseUri() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }

    public FakeRouteServer respond(int status, String json) {
        return respond(status, json.getBytes(StandardCharsets.UTF_8));
    }

    public FakeRouteServer respond(int status, byte[] payload) {
        this.status = status;
        this.body = payload;
        return this;
    }

    public FakeRouteServer delay(Duration delay) {
        this.delay = delay;
        return this;
    }

    public FakeRouteServer chunked(boolean chunked) {
        this.chunked = chunked;
        return this;
    }

    public List<Received> received() {
        return List.copyOf(received);
    }

    public void reset() {
        received.clear();
        status = 200;
        body = new byte[0];
        delay = Duration.ZERO;
        chunked = false;
    }

    @Override
    public void close() {
        server.stop(0);
        executor.shutdownNow();
    }
}
