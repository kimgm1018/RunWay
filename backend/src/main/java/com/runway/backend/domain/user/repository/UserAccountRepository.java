package com.runway.backend.domain.user.repository;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class UserAccountRepository {

    private final JdbcTemplate jdbc;

    public Optional<UserAccountRow> findById(long userId) {
        return jdbc
                .query(
                        """
                        SELECT id, nickname, gender::text, birth_date, login_id,
                               account_status::text, profile_image_key, updated_at
                        FROM users WHERE id = ?
                        """,
                        (rs, n) ->
                                new UserAccountRow(
                                        rs.getLong("id"),
                                        rs.getString("nickname"),
                                        rs.getString("gender"),
                                        rs.getDate("birth_date").toLocalDate(),
                                        rs.getString("login_id"),
                                        rs.getString("account_status"),
                                        rs.getString("profile_image_key"),
                                        rs.getTimestamp("updated_at").toInstant()),
                        userId)
                .stream()
                .findFirst();
    }

    /** 대소문자만 다른 닉네임도 같은 닉네임으로 본다. 본인 행은 제외해 본인 닉네임의 대소문자만 바꾸는 것은 허용한다(S15P31E105-831). */
    public boolean nicknameTakenByOther(String nickname, long userId) {
        Boolean exists =
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM users WHERE lower(nickname) = lower(?) AND id <> ? AND account_status = 'ACTIVE')",
                        Boolean.class,
                        nickname,
                        userId);
        return Boolean.TRUE.equals(exists);
    }

    public Optional<UserAccountRow> lock(long userId) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return jdbc
                .query(
                        """
                        SELECT id, nickname, gender::text, birth_date, login_id,
                               account_status::text, profile_image_key, updated_at
                        FROM users WHERE id = ? FOR UPDATE
                        """,
                        (rs, n) ->
                                new UserAccountRow(
                                        rs.getLong("id"),
                                        rs.getString("nickname"),
                                        rs.getString("gender"),
                                        rs.getDate("birth_date").toLocalDate(),
                                        rs.getString("login_id"),
                                        rs.getString("account_status"),
                                        rs.getString("profile_image_key"),
                                        rs.getTimestamp("updated_at").toInstant()),
                        userId)
                .stream()
                .findFirst();
    }

    public UserAccountRow update(
            long userId,
            String nickname,
            String gender,
            LocalDate birthDate,
            String profileImageKey) {
        return jdbc.query(
                        """
                        UPDATE users
                        SET nickname = ?,
                            gender = ?::users_gender_enum,
                            birth_date = ?,
                            profile_image_key = ?,
                            updated_at = now()
                        WHERE id = ?
                        RETURNING id, nickname, gender::text, birth_date, login_id,
                                  account_status::text, profile_image_key, updated_at
                        """,
                        (rs, n) ->
                                new UserAccountRow(
                                        rs.getLong("id"),
                                        rs.getString("nickname"),
                                        rs.getString("gender"),
                                        rs.getDate("birth_date").toLocalDate(),
                                        rs.getString("login_id"),
                                        rs.getString("account_status"),
                                        rs.getString("profile_image_key"),
                                        rs.getTimestamp("updated_at").toInstant()),
                        nickname,
                        gender,
                        Date.valueOf(birthDate),
                        profileImageKey,
                        userId)
                .getFirst();
    }

    public record UserAccountRow(
            long id,
            String nickname,
            String gender,
            LocalDate birthDate,
            String loginId,
            String status,
            String profileImageKey,
            Instant updatedAt) {
        @Override
        public String toString() {
            return "UserAccountRow[REDACTED]";
        }
    }
}
