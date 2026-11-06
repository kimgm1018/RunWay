package com.runway.backend.domain.community.repository;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CommunityUserQueryRepository {

    private final JdbcTemplate jdbcTemplate;

    public CommunityUserQueryRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean withdrawn(long userId) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND account_status='WITHDRAWN')",
                Boolean.class,userId));
    }

    public boolean existsById(long userId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM users WHERE id = ?", Integer.class, userId);
        return count != null && count > 0;
    }

    public Optional<String> findNickname(long userId) {
        return jdbcTemplate
                .query(
                        "SELECT nickname FROM users WHERE id = ?",
                        (rs, rowNum) -> rs.getString("nickname"),
                        userId)
                .stream()
                .findFirst();
    }

    public Map<Long, String> findNicknamesByIds(Collection<Long> userIds) {
        Map<Long, String> nicknames = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return nicknames;
        }
        Object[] args = userIds.toArray();
        String placeholders = String.join(",", Collections.nCopies(args.length, "?"));
        jdbcTemplate.query(
                "SELECT id, nickname FROM users WHERE id IN (" + placeholders + ")",
                rs -> {
                    nicknames.put(rs.getLong("id"), rs.getString("nickname"));
                },
                args);
        return nicknames;
    }
}
