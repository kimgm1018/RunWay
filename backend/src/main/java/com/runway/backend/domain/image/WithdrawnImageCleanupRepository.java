package com.runway.backend.domain.image;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
@RequiredArgsConstructor
public class WithdrawnImageCleanupRepository {
    private final JdbcTemplate jdbc;

    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
    public boolean isCommittedWithdrawal(long userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM users WHERE id=?
                    AND account_status='WITHDRAWN' AND withdrawn_at IS NOT NULL)
                """, Boolean.class, userId));
    }

    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
    public long maxWithdrawnId() {
        return jdbc.queryForObject("""
                SELECT coalesce(max(id), 0) FROM users WHERE account_status='WITHDRAWN'
                    AND withdrawn_at IS NOT NULL
                """, Long.class);
    }

    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
    public List<Long> findAfter(long lastId, long upperBound, int limit) {
        return jdbc.query("""
                SELECT id FROM users WHERE account_status='WITHDRAWN'
                    AND withdrawn_at IS NOT NULL AND id>? AND id<=? ORDER BY id LIMIT ?
                """, (rs, row) -> rs.getLong(1), lastId, upperBound, limit);
    }
}
