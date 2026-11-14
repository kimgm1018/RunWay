package com.runway.backend.domain.notification.push;

public enum PushSendResult {
    /** FCM accepted the message for this token. */
    SENT,
    /** FCM says the token is no longer (or never was) valid for this project; the token is deleted. */
    INVALID_TOKEN,
    /** Any other failure (timeout, quota, server error). The token is kept. */
    FAILED
}
