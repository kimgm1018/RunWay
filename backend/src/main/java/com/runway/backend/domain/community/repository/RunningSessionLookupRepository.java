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
        return jdbcTemplate
                .query(
                        """
                        SELECT id, user_id, course_id, status::text AS status, deleted_at,
                               total_distance, moving_duration, average_pace
                        FROM running_sessions
                        WHERE id = ?
                        """,
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
