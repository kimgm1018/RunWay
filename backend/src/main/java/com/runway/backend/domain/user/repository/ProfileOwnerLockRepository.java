package com.runway.backend.domain.user.repository;

import lombok.RequiredArgsConstructor;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ProfileOwnerLockRepository {
    private final JdbcTemplate jdbc;

    /** A missing profile cannot be locked. Lock its existing owner, as login does. */
    public boolean lock(long userId) {
        // Transaction-local PostgreSQL lock timeout, shared by JDBC and JPA in the same
        // transaction.
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return !jdbc.query(
                        "SELECT id FROM users WHERE id = ? FOR UPDATE",
                        (rs, row) -> rs.getLong(1),
                        userId)
                .isEmpty();
    }
}
