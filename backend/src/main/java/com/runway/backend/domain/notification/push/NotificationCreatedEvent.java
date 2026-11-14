package com.runway.backend.domain.notification.push;

/** Published inside the creating transaction when a new inbox row was inserted. */
public record NotificationCreatedEvent(long notificationId) {}
