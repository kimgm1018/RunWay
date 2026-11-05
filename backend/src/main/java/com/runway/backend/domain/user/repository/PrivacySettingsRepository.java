package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.user.dto.response.UpdatedPrivacySettingsResponse;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class PrivacySettingsRepository {
    private final JdbcTemplate jdbc;

    public Optional<UpdatedPrivacySettingsResponse> find(long userId) {
        return query(userId, "");
    }

    // Shared with U22/U23/U25: target users row -> target settings row -> follow rows.
    // Lock even when no follow row exists, so request creation cannot escape serialization.
    public Optional<UpdatedPrivacySettingsResponse> lock(long userId) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return query(userId, " FOR UPDATE");
    }

    private Optional<UpdatedPrivacySettingsResponse> query(long userId, String lock) {
        return jdbc.query("SELECT account_visibility::text, updated_at FROM user_settings"
                        + " WHERE user_id=?" + lock,
                (rs, row) -> new UpdatedPrivacySettingsResponse(
                        "PRIVATE".equals(rs.getString(1)), rs.getTimestamp(2).toInstant()), userId)
                .stream().findFirst();
    }

    public UpdatedPrivacySettingsResponse update(long userId, boolean isPrivate) {
        return jdbc.query("""
                UPDATE user_settings
                SET account_visibility=?::user_settings_account_visibility_enum
                WHERE user_id=? RETURNING account_visibility::text, updated_at
                """, (rs, row) -> new UpdatedPrivacySettingsResponse(
                        "PRIVATE".equals(rs.getString(1)), rs.getTimestamp(2).toInstant()),
                isPrivate ? "PRIVATE" : "PUBLIC", userId).getFirst();
    }

    public void approvePending(long userId) {
        jdbc.update("""
                UPDATE user_follows SET is_approved=TRUE
                WHERE followee_id=? AND is_approved=FALSE
                """, userId);
    }
}
