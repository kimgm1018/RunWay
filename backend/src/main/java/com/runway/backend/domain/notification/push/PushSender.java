package com.runway.backend.domain.notification.push;

/** Sends one push to one device token (ADR-0025). Implementations must not throw for per-token failures. */
public interface PushSender {

    /** false when push delivery is turned off; dispatch then leaves notification rows PENDING. */
    boolean enabled();

    PushSendResult send(PushMessage message);
}
