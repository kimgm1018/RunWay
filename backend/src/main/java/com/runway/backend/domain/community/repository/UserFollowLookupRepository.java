package com.runway.backend.domain.community.repository;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserFollowLookupRepository {

    private final JdbcTemplate jdbcTemplate;

    public UserFollowLookupRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean isApprovedFollower(long followerId, long followeeId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM user_follows
                        WHERE follower_id = ?
                          AND followee_id = ?
                          AND is_approved = TRUE
                        """,
                        Integer.class,
                        followerId,
                        followeeId);
        return count != null && count > 0;
    }

    public List<Long> findApprovedFolloweeIds(long followerId) {
        return jdbcTemplate.query(
                """
                SELECT followee_id
                FROM user_follows
                WHERE follower_id = ?
                  AND is_approved = TRUE
                """,
                (rs, rowNum) -> rs.getLong("followee_id"),
                followerId);
    }

    public Set<Long> findApprovedFolloweeIdsAmong(long followerId, Collection<Long> followeeIds) {
        Set<Long> approved = new HashSet<>();
        if (followeeIds == null || followeeIds.isEmpty()) {
            return approved;
        }
        Object[] args = new Object[followeeIds.size() + 1];
        args[0] = followerId;
        int index = 1;
        for (Long followeeId : followeeIds) {
            args[index++] = followeeId;
        }
        String placeholders =
                String.join(",", java.util.Collections.nCopies(followeeIds.size(), "?"));
        jdbcTemplate.query(
                """
                SELECT followee_id
                FROM user_follows
                WHERE follower_id = ?
                  AND is_approved = TRUE
                  AND followee_id IN (%s)
                """
                        .formatted(placeholders),
                rs -> {
                    approved.add(rs.getLong("followee_id"));
                },
                args);
        return approved;
    }
}
