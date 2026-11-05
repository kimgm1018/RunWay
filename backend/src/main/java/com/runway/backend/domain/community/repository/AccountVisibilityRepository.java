package com.runway.backend.domain.community.repository;

import java.util.Collection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.List;
import java.util.Set;
import java.util.HashSet;
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

    public boolean canAccess(long viewerId, long authorId) {
        return accessibleAmong(viewerId, List.of(authorId)).contains(authorId);
    }

    // Account visibility and follower approval must come from the same statement snapshot.
    public Set<Long> accessibleAmong(long viewerId, Collection<Long> authorIds) {
        if (authorIds.isEmpty()) {
            return Set.of();
        }
        String placeholders = String.join(",", Collections.nCopies(authorIds.size(), "?"));
        List<Object> args = new ArrayList<>(authorIds);
        args.add(viewerId);
        args.add(viewerId);
        return new HashSet<>(jdbcTemplate.query("""
                SELECT u.id FROM users u LEFT JOIN user_settings s ON s.user_id=u.id
                WHERE u.id IN (%s) AND u.account_status='ACTIVE' AND u.withdrawn_at IS NULL
                  AND (u.id=? OR s.account_visibility='PUBLIC'
                       OR EXISTS (SELECT 1 FROM user_follows f WHERE f.followee_id=u.id
                           AND f.follower_id=? AND f.is_approved=TRUE))
                """.formatted(placeholders), (rs, row) -> rs.getLong(1), args.toArray()));
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
