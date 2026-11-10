package com.runway.backend.domain.community.repository;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
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

    /** 작성자 표시용 닉네임과 프로필 사진 키를 한 번에 조회한다. 없는 회원은 결과에 넣지 않는다. */
    public Map<Long, AuthorRow> findAuthorsByIds(Collection<Long> userIds) {
        Map<Long, AuthorRow> authors = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return authors;
        }
        Object[] args = userIds.toArray();
        String placeholders = String.join(",", Collections.nCopies(args.length, "?"));
        jdbcTemplate.query(
                "SELECT id, nickname, profile_image_key FROM users WHERE id IN ("
                        + placeholders
                        + ")",
                rs -> {
                    AuthorRow row =
                            new AuthorRow(
                                    rs.getLong("id"),
                                    rs.getString("nickname"),
                                    rs.getString("profile_image_key"));
                    authors.put(row.userId(), row);
                },
                args);
        return authors;
    }

    public record AuthorRow(long userId, String nickname, String profileImageKey) {}
}
