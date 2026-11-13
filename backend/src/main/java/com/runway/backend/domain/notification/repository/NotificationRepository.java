package com.runway.backend.domain.notification.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class NotificationRepository {
    private final JdbcTemplate jdbc;

    public record Row(
            long id, String kind, String message, Instant createdAt, Instant readAt, long targetId) {}

    public record Settings(boolean groupRun, boolean community) {}

    public Optional<Settings> findSettings(long userId) {
        return jdbc.query(
                        """
                        SELECT group_notifications_enabled, community_notifications_enabled
                        FROM user_settings WHERE user_id=?
                        """,
                        (rs, n) -> new Settings(rs.getBoolean(1), rs.getBoolean(2)),
                        userId)
                .stream()
                .findFirst();
    }

    public Optional<String> findNickname(long userId) {
        return jdbc.query(
                        "SELECT nickname FROM users WHERE id=?",
                        (rs, n) -> rs.getString(1),
                        userId)
                .stream()
                .findFirst();
    }

    /** Inserts SENT row; returns empty when dedupe_key already exists. */
    public Optional<Long> insertIgnoringDuplicate(
            long userId, String kind, long targetId, String message, String dedupeKey) {
        List<Long> ids =
                jdbc.query(
                        """
                        INSERT INTO notifications(
                            user_id, sent_at, delivery_status, message,
                            notification_type, target_id, dedupe_key)
                        VALUES (
                            ?, now(), 'SENT'::notifications_delivery_status_enum, ?,
                            ?, ?, ?)
                        ON CONFLICT (dedupe_key) DO NOTHING
                        RETURNING id
                        """,
                        (rs, n) -> rs.getLong(1),
                        userId,
                        message,
                        kind,
                        targetId,
                        dedupeKey);
        return ids.stream().findFirst();
    }

    /** Removes the inbox row of a logical event (for example a withdrawn join request). */
    public int deleteByDedupeKey(String dedupeKey) {
        return jdbc.update("DELETE FROM notifications WHERE dedupe_key=?", dedupeKey);
    }

    public List<Row> list(long userId, Instant before, long beforeId, int limitPlusOne) {
        return jdbc.query(
                """
                SELECT id, notification_type, message, created_at, read_at, target_id
                FROM notifications
                WHERE user_id=?
                """
                        + (before == null ? "" : " AND (created_at, id) < (?, ?)")
                        + " ORDER BY created_at DESC, id DESC LIMIT ?",
                (rs, n) ->
                        new Row(
                                rs.getLong(1),
                                rs.getString(2),
                                rs.getString(3),
                                rs.getTimestamp(4).toInstant(),
                                rs.getTimestamp(5) == null
                                        ? null
                                        : rs.getTimestamp(5).toInstant(),
                                rs.getLong(6)),
                before == null
                        ? new Object[] {userId, limitPlusOne}
                        : new Object[] {
                            userId, Timestamp.from(before), beforeId, limitPlusOne
                        });
    }

    public long countUnread(long userId) {
        Long count =
                jdbc.queryForObject(
                        "SELECT count(*) FROM notifications WHERE user_id=? AND read_at IS NULL",
                        Long.class,
                        userId);
        return count == null ? 0L : count;
    }

    public void markAllRead(long userId, Long upToId) {
        if (upToId == null) {
            jdbc.update(
                    "UPDATE notifications SET read_at=now() WHERE user_id=? AND read_at IS NULL",
                    userId);
            return;
        }
        jdbc.update(
                "UPDATE notifications SET read_at=now() WHERE user_id=? AND read_at IS NULL AND id<=?",
                userId,
                upToId);
    }
}
