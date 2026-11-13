package com.runway.backend.domain.notification.service;

import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.dto.response.NotificationItemResponse;
import com.runway.backend.domain.notification.dto.response.NotificationListResponse;
import com.runway.backend.domain.notification.repository.NotificationRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class NotificationService {
    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;
    private static final int MAX_MESSAGE = 100;

    private final NotificationRepository notifications;

    /**
     * Creates an inbox row when the recipient's matching setting is on.
     *
     * @return {@code true} when a new row was inserted; {@code false} when skipped
     *     (setting off / missing settings) or when {@code dedupeKey} already exists
     */
    @Transactional
    public boolean create(
            long recipientUserId,
            NotificationType type,
            long targetId,
            String message,
            String dedupeKey) {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(dedupeKey, "dedupeKey");
        if (recipientUserId <= 0 || targetId <= 0 || dedupeKey.isBlank()) {
            throw new IllegalArgumentException("invalid notification create arguments");
        }
        var settings = notifications.findSettings(recipientUserId);
        if (settings.isEmpty()) {
            return false;
        }
        boolean enabled =
                type.usesCommunitySetting()
                        ? settings.get().community()
                        : settings.get().groupRun();
        if (!enabled) {
            return false;
        }
        String body = truncate(message == null ? "" : message);
        return notifications
                .insertIgnoringDuplicate(
                        recipientUserId, type.name(), targetId, body, dedupeKey)
                .isPresent();
    }

    /** Deletes the inbox row for {@code dedupeKey}; no-op when it does not exist. */
    @Transactional
    public void deleteByDedupeKey(String dedupeKey) {
        Objects.requireNonNull(dedupeKey, "dedupeKey");
        notifications.deleteByDedupeKey(dedupeKey);
    }

    @Transactional(readOnly = true)
    public NotificationListResponse list(long userId, String cursor, Integer limit) {
        int pageSize = resolveLimit(limit);
        Instant before = null;
        long beforeId = 0;
        if (cursor != null) {
            var decoded = decodeCursor(userId, cursor);
            before = decoded.createdAt();
            beforeId = decoded.id();
        }
        var rows = notifications.list(userId, before, beforeId, pageSize + 1);
        boolean hasNext = rows.size() > pageSize;
        var page = List.copyOf(rows.subList(0, Math.min(rows.size(), pageSize)));
        String next = null;
        if (hasNext) {
            var last = page.getLast();
            next = encodeCursor(userId, last.createdAt(), last.id());
        }
        var items =
                page.stream()
                        .map(
                                row ->
                                        new NotificationItemResponse(
                                                row.id(),
                                                row.kind(),
                                                row.message(),
                                                row.createdAt(),
                                                row.readAt() != null,
                                                row.targetId()))
                        .toList();
        return new NotificationListResponse(
                items, next, hasNext, notifications.countUnread(userId));
    }

    /** Marks the user's unread rows read; {@code upToId} null means all of them, otherwise ids up to it. */
    @Transactional
    public void markAllRead(long userId, Long upToId) {
        notifications.markAllRead(userId, upToId);
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(ErrorCode.NOTIFICATION_INVALID_FILTER);
        }
        return limit;
    }

    private record Cursor(Instant createdAt, long id) {}

    private static Cursor decodeCursor(long userId, String cursor) {
        try {
            if (cursor.length() > 256) {
                throw new IllegalArgumentException();
            }
            String[] parts =
                    new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                            .split("\\|", -1);
            if (parts.length != 3 || Long.parseLong(parts[0]) != userId) {
                throw new IllegalArgumentException();
            }
            Instant createdAt = Instant.parse(parts[1]);
            if (createdAt.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
                    || createdAt.isAfter(Instant.parse("9999-12-31T23:59:59.999999Z"))) {
                throw new IllegalArgumentException();
            }
            long id = Long.parseLong(parts[2]);
            if (id <= 0) {
                throw new IllegalArgumentException();
            }
            return new Cursor(createdAt, id);
        } catch (RuntimeException ex) {
            throw new ApiException(ErrorCode.NOTIFICATION_INVALID_FILTER);
        }
    }

    private static String encodeCursor(long userId, Instant createdAt, long id) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(
                        (userId + "|" + createdAt + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    private static String truncate(String message) {
        if (message.length() <= MAX_MESSAGE) {
            return message;
        }
        return message.substring(0, MAX_MESSAGE);
    }
}
