package com.runway.backend.domain.community.repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RunningSessionLookupRepository {

    private final JdbcTemplate jdbcTemplate;

    public RunningSessionLookupRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<SessionShareInfo> findById(long sessionId) {
        return queryById(sessionId, "");
    }

    /**
     * CMT01 생성용. 세션 행을 {@code FOR UPDATE}로 잠가 S09 삭제와 같은 순서로 직렬화한다. 호출 트랜잭션이 끝날 때까지
     * 잠금을 유지한다.
     */
    public Optional<SessionShareInfo> findByIdForUpdate(long sessionId) {
        return queryById(sessionId, " FOR UPDATE");
    }

    private Optional<SessionShareInfo> queryById(long sessionId, String lockClause) {
        return jdbcTemplate
                .query(
                        """
                        SELECT id, user_id, course_id, status::text AS status, deleted_at,
                               total_distance, moving_duration, average_pace
                        FROM running_sessions
                        WHERE id = ?
                        """
                                + lockClause,
                        (rs, rowNum) ->
                                new SessionShareInfo(
                                        rs.getLong("id"),
                                        rs.getLong("user_id"),
                                        (Long) rs.getObject("course_id"),
                                        rs.getString("status"),
                                        toInstant(rs.getTimestamp("deleted_at")),
                                        rs.getBigDecimal("total_distance"),
                                        (Integer) rs.getObject("moving_duration"),
                                        rs.getBigDecimal("average_pace")),
                        sessionId)
                .stream()
                .findFirst();
    }

    public Map<Long, SessionShareInfo> findByIds(Collection<Long> sessionIds) {
        Map<Long, SessionShareInfo> sessions = new HashMap<>();
        if (sessionIds == null || sessionIds.isEmpty()) {
            return sessions;
        }
        Object[] args = sessionIds.toArray();
        String placeholders = String.join(",", java.util.Collections.nCopies(args.length, "?"));
        jdbcTemplate.query(
                """
                SELECT id, user_id, course_id, status::text AS status, deleted_at,
                       total_distance, moving_duration, average_pace
                FROM running_sessions
                WHERE id IN (%s)
                """
                        .formatted(placeholders),
                rs -> {
                    SessionShareInfo info =
                            new SessionShareInfo(
                                    rs.getLong("id"),
                                    rs.getLong("user_id"),
                                    (Long) rs.getObject("course_id"),
                                    rs.getString("status"),
                                    toInstant(rs.getTimestamp("deleted_at")),
                                    rs.getBigDecimal("total_distance"),
                                    (Integer) rs.getObject("moving_duration"),
                                    rs.getBigDecimal("average_pace"));
                    sessions.put(info.id(), info);
                },
                args);
        return sessions;
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record SessionShareInfo(
            long id,
            long userId,
            Long courseId,
            String status,
            Instant deletedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace) {

        public boolean isCompleted() {
            return "COMPLETED".equals(status);
        }

        public boolean isDeleted() {
            return deletedAt != null;
        }
    }
}
