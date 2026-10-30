package com.runway.backend.domain.auth;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Test-only RESP transport fault injector. Never logs request bytes or credentials. */
final class RedisReplyProxy implements AutoCloseable {
    enum Fault {
        NONE,
        LOSE_REPLY,
        DISCONNECT_BEFORE_WRITE
    }

    private final ServerSocket listener;
    private final String host;
    private final int port;
    private final String createSha;
    private final java.util.concurrent.ExecutorService workers =
            Executors.newVirtualThreadPerTaskExecutor();
    private final List<Socket> sockets = new CopyOnWriteArrayList<>();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean dropReplies = new AtomicBoolean();
    private final AtomicBoolean armed = new AtomicBoolean();
    final AtomicInteger createRequests = new AtomicInteger();
    final AtomicReference<String> familyKey = new AtomicReference<>();
    final AtomicReference<String> expiresAt = new AtomicReference<>();
    private final AtomicReference<Fault> fault = new AtomicReference<>(Fault.NONE);

    RedisReplyProxy(String host, int port, String createSha) throws IOException {
        this.host = host;
        this.port = port;
        this.createSha = createSha;
        listener = new ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress());
        workers.submit(
                () -> {
                    while (!closed.get()) {
                        try {
                            Socket client = listener.accept();
                            Socket upstream = new Socket(host, port);
                            sockets.add(client);
                            sockets.add(upstream);
                            workers.submit(() -> commands(client, upstream));
                            workers.submit(() -> replies(client, upstream));
                        } catch (IOException ignored) {
                            if (closed.get()) return;
                        }
                    }
                });
    }

    String host() {
        return listener.getInetAddress().getHostAddress();
    }

    int port() {
        return listener.getLocalPort();
    }

    void arm(Fault next) {
        createRequests.set(0);
        familyKey.set(null);
        expiresAt.set(null);
        fault.set(next);
        armed.set(true);
    }

    private void commands(Socket client, Socket upstream) {
        try {
            var input = new BufferedInputStream(client.getInputStream());
            while (!closed.get()) {
                Frame frame = readFrame(input);
                if (frame == null) return;
                List<String> args = frame.args();
                boolean creation =
                        args.size() > 3
                                && args.get(0).equalsIgnoreCase("EVALSHA")
                                && args.get(1).equals(createSha);
                if (creation && armed.get()) {
                    createRequests.incrementAndGet();
                    familyKey.compareAndSet(null, args.get(3));
                    int keyCount = Integer.parseInt(args.get(2));
                    if (args.size() > 7 + keyCount)
                        expiresAt.compareAndSet(null, args.get(7 + keyCount));
                    Fault current = fault.getAndSet(Fault.NONE);
                    if (current == Fault.DISCONNECT_BEFORE_WRITE) {
                        client.close();
                        upstream.close();
                        return;
                    }
                    if (current == Fault.LOSE_REPLY) dropReplies.set(true);
                }
                upstream.getOutputStream().write(frame.bytes());
                upstream.getOutputStream().flush();
            }
        } catch (IOException ignored) {
        }
    }

    private void replies(Socket client, Socket upstream) {
        try {
            byte[] bytes = new byte[8192];
            int length;
            while ((length = upstream.getInputStream().read(bytes)) >= 0) {
                if (!dropReplies.get()) {
                    client.getOutputStream().write(bytes, 0, length);
                    client.getOutputStream().flush();
                }
            }
        } catch (IOException ignored) {
        }
    }

    private Frame readFrame(InputStream input) throws IOException {
        int first = input.read();
        if (first < 0) return null;
        if (first != '*') throw new IOException("Expected a RESP command array");
        var bytes = new ByteArrayOutputStream();
        bytes.write(first);
        String countLine = line(input, bytes);
        int count = Integer.parseInt(countLine);
        var args = new ArrayList<String>();
        for (int i = 0; i < count; i++) {
            int prefix = input.read();
            if (prefix != '$') throw new IOException("Expected a bulk command argument");
            bytes.write(prefix);
            int length = Integer.parseInt(line(input, bytes));
            if (length < 0) {
                args.add("");
                continue;
            }
            byte[] value = input.readNBytes(length);
            if (value.length != length) throw new IOException("Truncated command");
            bytes.write(value);
            if (input.read() != '\r' || input.read() != '\n')
                throw new IOException("Invalid bulk terminator");
            bytes.write('\r');
            bytes.write('\n');
            args.add(new String(value, StandardCharsets.UTF_8));
        }
        return new Frame(bytes.toByteArray(), args);
    }

    private String line(InputStream input, ByteArrayOutputStream copy) throws IOException {
        var value = new ByteArrayOutputStream();
        int next;
        while ((next = input.read()) != '\r') {
            if (next < 0 || value.size() > 1024) throw new IOException("Invalid RESP length");
            copy.write(next);
            value.write(next);
        }
        if (input.read() != '\n') throw new IOException("Invalid RESP line");
        copy.write('\r');
        copy.write('\n');
        return value.toString(StandardCharsets.US_ASCII);
    }

    private record Frame(byte[] bytes, List<String> args) {
        @Override
        public String toString() {
            return "Frame[REDACTED]";
        }
    }

    @Override
    public void close() {
        closed.set(true);
        try {
            listener.close();
        } catch (IOException ignored) {
        }
        for (Socket socket : sockets)
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        workers.shutdownNow();
        workers.close();
    }
}
