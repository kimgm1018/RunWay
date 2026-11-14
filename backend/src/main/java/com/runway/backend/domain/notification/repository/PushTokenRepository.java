package com.runway.backend.domain.notification.repository;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** FCM registration tokens per member (push_device_tokens, V42). */
@Repository
@RequiredArgsConstructor
public class PushTokenRepository {
    private final JdbcTemplate jdbc;

    /**
     * Stores the token for {@code userId}. A token already held by another member moves to this member (the same
     * device signed in to another account); a token already held by this member only refreshes {@code updated_at}.
     */
    public void upsert(long userId, String token, String platform) {
        jdbc.update(
                """
                INSERT INTO push_device_tokens(user_id, token, platform)
                VALUES (?, ?, ?)
                ON CONFLICT (token) DO UPDATE
                    SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()
                """,
                userId,
                token,
                platform);
    }

    /** Keeps only the {@code limit} most recently updated tokens of the member. */
    public int trimToLimit(long userId, int limit) {
        return jdbc.update(
                """
                DELETE FROM push_device_tokens
                WHERE user_id = ? AND id NOT IN (
                    SELECT id FROM push_device_tokens WHERE user_id = ?
                    ORDER BY updated_at DESC, id DESC LIMIT ?)
                """,
                userId,
                userId,
                limit);
    }

    /** Deletes the token only when this member owns it. */
    public int deleteOwned(long userId, String token) {
        return jdbc.update(
                "DELETE FROM push_device_tokens WHERE user_id = ? AND token = ?", userId, token);
    }

    /** Deletes a token FCM reported as no longer valid, whoever holds it now. */
    public int deleteToken(String token) {
        return jdbc.update("DELETE FROM push_device_tokens WHERE token = ?", token);
    }

    /** Whether the token still belongs to the member (it may have moved to another account or been deleted). */
    public boolean isOwnedBy(long userId, String token) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM push_device_tokens WHERE user_id = ? AND token = ?)",
                        Boolean.class,
                        userId,
                        token));
    }

    public List<String> findTokens(long userId) {
        return jdbc.query(
                "SELECT token FROM push_device_tokens WHERE user_id = ? ORDER BY id",
                (rs, n) -> rs.getString(1),
                userId);
    }
}
