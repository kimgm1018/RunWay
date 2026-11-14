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

    /**
     * 대소문자 구분 없이 아이디로 찾는다(S15P31E105-831). 저장값은 항상 소문자이며 lower 식 고유 인덱스를 쓴다. 호출자가 소문자화를
     * 빠뜨려도 같은 계정을 찾도록 입력에도 lower()를 씌운다.
     */
    public Optional<Account> findByLoginId(String loginId) {
        return jdbc
                .query(
                        "SELECT id, login_id, password, account_status::text FROM users WHERE"
                                + " lower(login_id) = lower(?)",
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

    /** 비밀번호 해시를 바꾼다(users.md U30, S15P31E105-560). {@link #lock(long)}과 같은 트랜잭션에서만 호출한다. */
    public void updatePassword(long userId, String hash) {
        int updated =
                jdbc.update(
                        "UPDATE users SET password=?, updated_at=now() WHERE id=? AND account_status='ACTIVE'",
                        hash,
                        userId);
        if (updated != 1) throw new IllegalStateException("비밀번호를 바꿀 회원이 없습니다.");
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
