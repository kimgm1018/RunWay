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
            int strugglingCount, Instant updatedAt, String mode, Integer aiPace, Long basisUserId,
            String basisNickname, Integer slowerThanGoalCount, Instant startRequestedAt,
            boolean startRequestRecent) {
        public State(Integer pace, Integer startPace, String direction, Instant changedAt,
                int strugglingCount, Instant updatedAt) {
            this(pace, startPace, direction, changedAt, strugglingCount, updatedAt, MODE_TOGETHER,
                    null, null, null, null, null, false);
        }

        public boolean goalMode() { return MODE_GOAL.equals(mode); }

        /**
         * A recalculation was requested within the last two minutes (DB clock, the same clock that stamped it) and has
         * neither finished nor given up.
         */
        public boolean calculating() {
            return startPace == null && startRequestRecent;
        }
    }

    public static final String MODE_TOGETHER = "TOGETHER";
    public static final String MODE_GOAL = "GOAL";

    /** Start result: applied pace, AI recommendation, its member and the slower-than-goal count. */
    public record Start(int pace, int aiPace, long basisUserId, Integer slowerThanGoalCount) {}
    public record Runner(long userId, long sessionId, String status, Instant startedAt,
            boolean consent) {}
    public record Candidate(long userId, boolean consent, BigDecimal profilePace) {}

    public Optional<State> find(long groupId) {
        return jdbc.query("""
                SELECT s.*,
                    -- The basis member's name only while they still share health data (consent can be withdrawn).
                    CASE WHEN u.account_status = 'ACTIVE' AND u.health_data_access = 'AGREE'
                         THEN u.nickname END AS basis_nickname,
                    COALESCE(s.start_requested_at > clock_timestamp() - interval '120 seconds', FALSE)
                        AS start_request_recent
                FROM group_run_pace_state s
                LEFT JOIN users u ON u.id = s.pace_basis_user_id
                WHERE s.group_run_id = ?
                """,
                (rs, n) -> new State(rs.getObject("group_pace_sec_per_km", Integer.class),
                        rs.getObject("start_recommended_pace_sec_per_km", Integer.class),
                        rs.getString("last_change_direction"),
                        instant(rs.getTimestamp("last_change_at")),
                        rs.getInt("struggling_count"), rs.getTimestamp("updated_at").toInstant(),
                        rs.getString("pace_mode"),
                        rs.getObject("ai_recommended_pace_sec_per_km", Integer.class),
                        rs.getObject("pace_basis_user_id", Long.class),
                        rs.getString("basis_nickname"),
                        rs.getObject("slower_than_goal_count", Integer.class),
                        instant(rs.getTimestamp("start_requested_at")),
                        rs.getBoolean("start_request_recent")),
                groupId).stream().findFirst();
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
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
                INSERT INTO group_run_pace_state(group_run_id, start_requested_at)
                VALUES (?, clock_timestamp())
                ON CONFLICT (group_run_id) DO UPDATE SET start_recommended_pace_sec_per_km = NULL,
                    ai_recommended_pace_sec_per_km = NULL, pace_basis_user_id = NULL,
                    slower_than_goal_count = NULL, start_requested_at = clock_timestamp()
                """, groupId);
    }

    /** Host mode change. The caller invalidates in the same transaction so a recalculation follows. */
    public void saveMode(long groupId, String mode) {
        jdbc.update("""
                INSERT INTO group_run_pace_state(group_run_id, pace_mode) VALUES (?, ?)
                ON CONFLICT (group_run_id) DO UPDATE SET pace_mode = EXCLUDED.pace_mode
                """, groupId, mode);
    }

    /** A calculation that cannot produce a value ends the calculating state, unless superseded. */
    public boolean abandonStart(long groupId, Instant token) {
        return jdbc.update("""
                UPDATE group_run_pace_state SET start_requested_at = NULL
                WHERE group_run_id = ? AND updated_at = ? AND start_requested_at IS NOT NULL
                """, groupId, Timestamp.from(token)) == 1;
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

    public boolean saveStart(long groupId, Instant token, Start start) {
        return jdbc.update("""
                UPDATE group_run_pace_state SET start_recommended_pace_sec_per_km = ?,
                    ai_recommended_pace_sec_per_km = ?, pace_basis_user_id = ?,
                    slower_than_goal_count = ?, start_requested_at = NULL
                WHERE group_run_id = ? AND updated_at = ?
                  AND EXISTS (SELECT 1 FROM group_runs WHERE id = ? AND status = 'SCHEDULED')
                """, start.pace(), start.aiPace(), start.basisUserId(), start.slowerThanGoalCount(),
                groupId, Timestamp.from(token), groupId) == 1;
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
