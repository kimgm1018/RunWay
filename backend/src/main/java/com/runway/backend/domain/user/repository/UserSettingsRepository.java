package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.user.dto.request.UserSettingsRequest;
import com.runway.backend.domain.user.dto.response.UserSettingsResponse;
import com.runway.backend.domain.user.dto.response.UserSettingsResponse.Notifications;

import lombok.RequiredArgsConstructor;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class UserSettingsRepository {
    private final JdbcTemplate jdbc;
    private static final String COLUMNS =
            "voice_coaching_enabled,bpm_guide_enabled,"
                + "location_collection_mode::text,group_notifications_enabled,community_notifications_enabled";

    public Optional<UserSettingsResponse> find(long userId) {
        return jdbc
                .query(
                        "SELECT " + COLUMNS + " FROM user_settings WHERE user_id=?",
                        (rs, row) -> response(rs),
                        userId)
                .stream()
                .findFirst();
    }

    public Optional<UserSettingsResponse> update(long userId, UserSettingsRequest patch) {
        // One row-level write serializes concurrent patches. COALESCE preserves current DB values,
        // rather than values from an earlier application read. Never writes account_visibility.
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return jdbc
                .query(
                        """
                        UPDATE user_settings SET
                            voice_coaching_enabled=COALESCE(?,voice_coaching_enabled),
                            bpm_guide_enabled=COALESCE(?,bpm_guide_enabled),
                            location_collection_mode=COALESCE(?::user_settings_location_collection_mode_enum,location_collection_mode),
                            group_notifications_enabled=COALESCE(?,group_notifications_enabled),
                            community_notifications_enabled=COALESCE(?,community_notifications_enabled)
                        WHERE user_id=? RETURNING
                        """
                                + COLUMNS,
                        (rs, row) -> response(rs),
                        patch.voiceCoachingEnabled(),
                        patch.bpmGuideEnabled(),
                        patch.locationRecordingMode(),
                        patch.groupRun(),
                        patch.community(),
                        userId)
                .stream()
                .findFirst();
    }

    private static UserSettingsResponse response(ResultSet rs) throws SQLException {
        return new UserSettingsResponse(
                rs.getBoolean(1),
                rs.getBoolean(2),
                rs.getString(3),
                new Notifications(rs.getBoolean(4), rs.getBoolean(5)));
    }
}
