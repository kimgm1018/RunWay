package com.runway.backend.domain.notification.push;

import java.util.Map;
import java.util.Objects;

/** One device push. {@code data} carries what the app needs to open the target screen. */
public record PushMessage(String token, String title, String body, Map<String, String> data) {
    public PushMessage {
        Objects.requireNonNull(token, "token");
        Objects.requireNonNull(title, "title");
        Objects.requireNonNull(body, "body");
        data = Map.copyOf(data);
    }

    /** Token prefix for logs; the full token identifies a device and is never logged. */
    public String maskedToken() {
        return token.length() <= 8 ? "****" : token.substring(0, 8) + "****";
    }

    @Override
    public String toString() {
        return "PushMessage[token=" + maskedToken() + ", data=" + data + "]";
    }
}
