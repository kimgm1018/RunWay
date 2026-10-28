package com.runway.backend.domain.community.repository;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AccountVisibilityRepository {

    public static final String PUBLIC = "PUBLIC";
    public static final String PRIVATE = "PRIVATE";

    private final JdbcTemplate jdbcTemplate;

    public AccountVisibilityRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<String> findByUserId(long userId) {
        return jdbcTemplate
                .query(
                        """
                        SELECT account_visibility::text AS account_visibility
                        FROM user_settings
                        WHERE user_id = ?
                        """,
                        (rs, rowNum) -> rs.getString("account_visibility"),
                        userId)
                .stream()
                .findFirst();
    }

    public Map<Long, String> findByUserIds(Collection<Long> userIds) {
        Map<Long, String> visibilityByUserId = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return visibilityByUserId;
        }
        Object[] args = userIds.toArray();
        String placeholders = String.join(",", Collections.nCopies(args.length, "?"));
        jdbcTemplate.query(
                """
                SELECT user_id, account_visibility::text AS account_visibility
                FROM user_settings
                WHERE user_id IN (%s)
                """
                        .formatted(placeholders),
                rs -> {
                    visibilityByUserId.put(
                            rs.getLong("user_id"), rs.getString("account_visibility"));
                },
                args);
        return visibilityByUserId;
    }
}
