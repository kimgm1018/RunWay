package com.runway.backend.domain.grouprun.pace;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** JDBC upserts arbitrate calls across backend instances; no lock spans an AI request. */
@Repository
@RequiredArgsConstructor
public class GroupPaceRepository {
    private final JdbcTemplate jdbc;

    public record State(Integer pace, Integer startPace, String direction, Instant changedAt,
            int strugglingCount, Instant updatedAt) {}
    public record Runner(long userId, long sessionId, String status, Instant startedAt,
            boolean consent) {}
    public record Candidate(long userId, boolean consent, BigDecimal profilePace) {}

    public Optional<State> find(long groupId) {
        return jdbc.query("SELECT * FROM group_run_pace_state WHERE group_run_id = ?",
                (rs, n) -> new State(rs.getObject("group_pace_sec_per_km", Integer.class),
                        rs.getObject("start_recommended_pace_sec_per_km", Integer.class),
                        rs.getString("last_change_direction"),
                        rs.getTimestamp("last_change_at") == null ? null
                                : rs.getTimestamp("last_change_at").toInstant(),
                        rs.getInt("struggling_count"), rs.getTimestamp("updated_at").toInstant()),
                groupId).stream().findFirst();
    }

    /** updated_at is also the lease token. Failed requests retain their reservation. */
    public Optional<Instant> reserve(long groupId, Instant expectedToken) {
        return jdbc.query("""
                INSERT INTO group_run_pace_state(group_run_id)
                SELECT id FROM group_runs WHERE id = ? AND status = 'RUNNING'
                ON CONFLICT (group_run_id) DO UPDATE SET updated_at = clock_timestamp()
                WHERE group_run_pace_state.updated_at = ?
                  AND group_run_pace_state.updated_at <= clock_timestamp() - interval '30 seconds'
                RETURNING updated_at
                """, (rs, n) -> rs.getTimestamp(1).toInstant(), groupId,
                expectedToken == null ? null : Timestamp.from(expectedToken)).stream().findFirst();
    }

    public boolean consented(long userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM users WHERE id = ? AND account_status = 'ACTIVE'
                    AND health_data_access = 'AGREE')
                """, Boolean.class, userId));
    }

    public Optional<Instant> startedAt(long groupId) {
        Timestamp value = jdbc.queryForObject("SELECT started_at FROM group_runs WHERE id = ?",
                Timestamp.class, groupId);
        return Optional.ofNullable(value).map(Timestamp::toInstant);
    }

    /** Invalidate before publishing the after-commit event, so old calculations cannot win. */
    public void invalidateStart(long groupId) {
        jdbc.update("""
                INSERT INTO group_run_pace_state(group_run_id) VALUES (?)
                ON CONFLICT (group_run_id) DO UPDATE SET start_recommended_pace_sec_per_km = NULL
                """, groupId);
    }

    public boolean saveRunning(long groupId, Instant token, GroupPacePort.Result result,
            Instant evaluatedAt) {
        return jdbc.update("""
                UPDATE group_run_pace_state SET group_pace_sec_per_km = ?, struggling_count = ?,
                    last_change_direction = CASE WHEN ? THEN ? ELSE last_change_direction END,
                    last_change_at = CASE WHEN ? THEN ? ELSE last_change_at END
                WHERE group_run_id = ? AND updated_at = ?
                  AND EXISTS (SELECT 1 FROM group_runs WHERE id = ? AND status = 'RUNNING')
                """, result.groupPaceSecPerKm(), result.strugglingCount(), result.changed(),
                result.direction(), result.changed(), Timestamp.from(evaluatedAt), groupId,
                Timestamp.from(token), groupId) == 1;
    }

    public boolean saveStart(long groupId, Instant token, int pace) {
        return jdbc.update("""
                UPDATE group_run_pace_state SET start_recommended_pace_sec_per_km = ?
                WHERE group_run_id = ? AND updated_at = ?
                  AND EXISTS (SELECT 1 FROM group_runs WHERE id = ? AND status = 'SCHEDULED')
                """, pace, groupId, Timestamp.from(token), groupId) == 1;
    }

    public List<Runner> runners(long groupId) {
        return jdbc.query("""
                SELECT p.user_id, s.id, s.status::text, s.started_at,
                       (u.account_status = 'ACTIVE' AND u.health_data_access = 'AGREE') AS consent
                FROM group_run_participants p
                JOIN running_sessions s ON s.id = p.session_id AND s.deleted_at IS NULL
                JOIN users u ON u.id = p.user_id
                WHERE p.group_run_id = ? AND s.started_at IS NOT NULL
                ORDER BY p.id
                """, (rs, n) -> new Runner(rs.getLong("user_id"), rs.getLong("id"),
                        rs.getString("status"), rs.getTimestamp("started_at").toInstant(),
                        rs.getBoolean("consent")), groupId);
    }

    public List<Candidate> candidates(long groupId) {
        return jdbc.query("""
                SELECT p.user_id, (u.account_status = 'ACTIVE'
                    AND u.health_data_access = 'AGREE') AS consent, up.average_pace
                FROM group_run_participants p JOIN users u ON u.id = p.user_id
                LEFT JOIN user_profiles up ON up.user_id = p.user_id
                WHERE p.group_run_id = ? ORDER BY p.id
                """, (rs, n) -> new Candidate(rs.getLong("user_id"), rs.getBoolean("consent"),
                        rs.getBigDecimal("average_pace")), groupId);
    }

    /** Same latest-five selection as myFit, retaining session distances for Riegel conversion. */
    public List<BigDecimal> recentPaces(long userId, int distanceM) {
        return jdbc.query("""
                SELECT average_pace, total_distance FROM running_sessions
                WHERE user_id = ? AND status = 'COMPLETED' AND deleted_at IS NULL
                    AND average_pace > 0 AND total_distance > 0
                    AND average_pace NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
                    AND total_distance NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
                ORDER BY COALESCE(ended_at, started_at) DESC NULLS LAST, id DESC LIMIT 5
                """, (rs, n) -> BigDecimal.valueOf(rs.getDouble("average_pace")
                        * Math.pow(distanceM / rs.getDouble("total_distance"), 0.06)), userId);
    }
}
