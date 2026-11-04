package com.runway.backend.domain.grouprun.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class GroupRunParticipantJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public GroupRunParticipantJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Instant insert(long groupRunId, long userId, boolean ready) {
        return jdbcTemplate.queryForObject(
                """
                INSERT INTO group_run_participants(group_run_id, user_id, session_id, ready)
                VALUES (?, ?, NULL, ?)
                RETURNING joined_at
                """,
                (rs, rowNum) -> toInstant(rs.getTimestamp("joined_at")),
                groupRunId,
                userId,
                ready);
    }

    public boolean exists(long groupRunId, long userId) {
        Boolean exists =
                jdbcTemplate.queryForObject(
                        """
                        SELECT EXISTS(
                          SELECT 1 FROM group_run_participants
                          WHERE group_run_id = ? AND user_id = ?
                        )
                        """,
                        Boolean.class,
                        groupRunId,
                        userId);
        return Boolean.TRUE.equals(exists);
    }

    public Optional<GroupRunParticipantRow> find(long groupRunId, long userId) {
        List<GroupRunParticipantRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, group_run_id, user_id, session_id, joined_at, ready
                        FROM group_run_participants
                        WHERE group_run_id = ? AND user_id = ?
                        """,
                        (rs, rowNum) -> mapRow(rs),
                        groupRunId,
                        userId);
        return rows.stream().findFirst();
    }

    public int delete(long groupRunId, long userId) {
        return jdbcTemplate.update(
                """
                DELETE FROM group_run_participants
                WHERE group_run_id = ? AND user_id = ?
                """,
                groupRunId,
                userId);
    }

    public List<GroupRunParticipantRow> findByGroupRunId(long groupRunId) {
        return jdbcTemplate.query(
                """
                SELECT id, group_run_id, user_id, session_id, joined_at, ready
                FROM group_run_participants
                WHERE group_run_id = ?
                ORDER BY joined_at ASC, id ASC
                """,
                (rs, rowNum) -> mapRow(rs),
                groupRunId);
    }

    public int updateReady(long groupRunId, long userId, boolean ready) {
        return jdbcTemplate.update(
                """
                UPDATE group_run_participants
                SET ready = ?
                WHERE group_run_id = ? AND user_id = ?
                """,
                ready,
                groupRunId,
                userId);
    }

    public int updateSessionAndReady(
            long groupRunId, long userId, Long sessionId, boolean ready) {
        return jdbcTemplate.update(
                """
                UPDATE group_run_participants
                SET session_id = ?, ready = ?
                WHERE group_run_id = ? AND user_id = ?
                """,
                sessionId,
                ready,
                groupRunId,
                userId);
    }

    public int countByGroupRunId(long groupRunId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*) FROM group_run_participants WHERE group_run_id = ?
                        """,
                        Integer.class,
                        groupRunId);
        return count == null ? 0 : count;
    }

    public int countReadyByGroupRunId(long groupRunId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*) FROM group_run_participants
                        WHERE group_run_id = ? AND ready = TRUE
                        """,
                        Integer.class,
                        groupRunId);
        return count == null ? 0 : count;
    }

    private static GroupRunParticipantRow mapRow(ResultSet rs) throws SQLException {
        return new GroupRunParticipantRow(
                rs.getLong("id"),
                rs.getLong("group_run_id"),
                rs.getLong("user_id"),
                rs.getObject("session_id", Long.class),
                toInstant(rs.getTimestamp("joined_at")),
                rs.getBoolean("ready"));
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
