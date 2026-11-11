package com.runway.backend.domain.community.repository;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserSearchRepository {

    private final JdbcTemplate jdbcTemplate;

    public UserSearchRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * ACTIVE·미탈퇴 회원을 닉네임 부분 일치(대소문자 무시)로 id 오름차순 keyset 조회한다. {@code escapedQuery}는 {@code !}를
     * 이스케이프 문자로 이미 처리된 값이어야 한다.
     */
    public List<UserSearchRow> searchActiveByNickname(
            String escapedQuery, long afterId, int fetchSize) {
        return jdbcTemplate.query(
                """
                SELECT id, nickname, profile_image_key
                FROM users
                WHERE account_status = 'ACTIVE'
                  AND withdrawn_at IS NULL
                  AND nickname ILIKE ? ESCAPE '!'
                  AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (rs, rowNum) ->
                        new UserSearchRow(
                                rs.getLong("id"),
                                rs.getString("nickname"),
                                rs.getString("profile_image_key")),
                "%" + escapedQuery + "%",
                afterId,
                fetchSize);
    }

    public record UserSearchRow(long id, String nickname, String profileImageKey) {}
}
