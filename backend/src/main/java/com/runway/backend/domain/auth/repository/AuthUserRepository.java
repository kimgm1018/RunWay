package com.runway.backend.domain.auth.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class AuthUserRepository {
    private final JdbcTemplate jdbc;

    public AuthUserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Account> findByLoginId(String loginId) {
        return jdbc
                .query(
                        "SELECT id, login_id, password, account_status::text FROM users WHERE"
                                + " login_id = ?",
                        (rs, n) ->
                                new Account(
                                        rs.getLong(1),
                                        rs.getString(2),
                                        rs.getString(3),
                                        rs.getString(4)),
                        loginId)
                .stream()
                .findFirst();
    }

    public Optional<Account> lock(long userId) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return jdbc
                .query(
                        "SELECT id, login_id, password, account_status::text FROM users WHERE id ="
                                + " ? FOR UPDATE",
                        (rs, n) ->
                                new Account(
                                        rs.getLong(1),
                                        rs.getString(2),
                                        rs.getString(3),
                                        rs.getString(4)),
                        userId)
                .stream()
                .findFirst();
    }

    public record Account(long id, String loginId, String passwordHash, String status) {
        public boolean active() {
            return "ACTIVE".equals(status);
        }

        @Override
        public String toString() {
            return "Account[REDACTED]";
        }
    }
}
