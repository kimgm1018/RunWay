package com.runway.backend.domain.grouprun.pace;

import com.runway.backend.domain.grouprun.helper.GroupRunFitCalculator;

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

    /**
     * Start result: applied pace, AI recommendation, its member, the slower-than-goal count and the basis plan's km
     * segment ratios (S15P31E105-739, empty when the plan had none usable).
     */
    public record Start(int pace, int aiPace, long basisUserId, Integer slowerThanGoalCount,
            List<SegmentRatio> segments) {
        public Start {
            segments = List.copyOf(segments);
        }

        public Start(int pace, int aiPace, long basisUserId, Integer slowerThanGoalCount) {
            this(pace, aiPace, basisUserId, slowerThanGoalCount, List.of());
        }
    }

    /** One km segment of the basis plan: its distance range (m) and its pace as a ratio of the plan mean. */
    public record SegmentRatio(BigDecimal startDistanceM, BigDecimal endDistanceM, BigDecimal ratio) {}
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
                    start_segment_ratios = NULL,
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
                    slower_than_goal_count = ?, start_requested_at = NULL,
                    start_segment_ratios = CAST(CAST(? AS text) AS jsonb)
                WHERE group_run_id = ? AND updated_at = ?
                  AND EXISTS (SELECT 1 FROM group_runs WHERE id = ? AND status = 'SCHEDULED')
                """, start.pace(), start.aiPace(), start.basisUserId(), start.slowerThanGoalCount(),
                ratiosJson(start.segments()), groupId, Timestamp.from(token), groupId) == 1;
    }

    private static String ratiosJson(List<SegmentRatio> segments) {
        if (segments.isEmpty()) return null;
        StringBuilder json = new StringBuilder("[");
        for (var segment : segments) {
            if (json.length() > 1) json.append(',');
            json.append("{\"startDistanceM\":").append(segment.startDistanceM().toPlainString())
                    .append(",\"endDistanceM\":").append(segment.endDistanceM().toPlainString())
                    .append(",\"ratio\":").append(segment.ratio().toPlainString()).append('}');
        }
        return json.append(']').toString();
    }

    /** One km of the shared start plan: distance range (m) and pace (s/km, two decimals). */
    public record SegmentPace(BigDecimal startDistanceM, BigDecimal endDistanceM, BigDecimal pace) {}

    /**
     * km paces of the stored start plan (S15P31E105-739): the stored start pace x the basis plan's ratios, read in one
     * statement so a recalculation committing in between cannot mix an old pace with new ratios (review B-2). Empty
     * when there is no start pace or no ratios, or when the basis member no longer shares health data (B-3).
     */
    public List<SegmentPace> findStartSegments(long groupId) {
        return jdbc.query("""
                SELECT (e->>'startDistanceM')::numeric AS start_m, (e->>'endDistanceM')::numeric AS end_m,
                       ROUND(s.start_recommended_pace_sec_per_km * (e->>'ratio')::numeric, 2) AS pace
                FROM group_run_pace_state s
                JOIN users u ON u.id = s.pace_basis_user_id
                    AND u.account_status = 'ACTIVE' AND u.health_data_access = 'AGREE'
                CROSS JOIN LATERAL jsonb_array_elements(s.start_segment_ratios) WITH ORDINALITY AS t(e, n)
                WHERE s.group_run_id = ? AND s.start_segment_ratios IS NOT NULL
                  AND s.start_recommended_pace_sec_per_km IS NOT NULL
                ORDER BY t.n
                """, (rs, n) -> new SegmentPace(rs.getBigDecimal("start_m"), rs.getBigDecimal("end_m"),
                        rs.getBigDecimal("pace")), groupId);
    }

    /**
     * 기동 시 다시 계산할 예정 그룹런(S15P31E105-817): 출발 페이스는 있는데 km 비율이 NULL이다. 목표 거리가 없으면 계산이 비율을 만들지
     * 않으므로, 예정 시각이 하루 넘게 지난 채 방치된 방은 의미가 없으므로 제외한다. 곧 열릴 미래 방을 먼저, 그다음 지난 방을 각각 예정 시각이 지금과
     * 가까운 순으로 최대 limit개(지난 방이 미래 방을 상한 밖으로 밀어내지 않는다).
     */
    public List<Long> findStartBackfillTargets(int limit) {
        return jdbc.queryForList("""
                SELECT s.group_run_id FROM group_run_pace_state s
                JOIN group_runs g ON g.id = s.group_run_id
                WHERE g.status = 'SCHEDULED' AND g.goal_distance > 0
                  AND g.scheduled_at > now() - interval '1 day'
                  AND s.start_recommended_pace_sec_per_km IS NOT NULL
                  AND s.start_segment_ratios IS NULL
                ORDER BY (g.scheduled_at < now()), ABS(EXTRACT(EPOCH FROM (g.scheduled_at - now()))),
                         s.group_run_id
                LIMIT ?
                """, Long.class, limit);
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

    /**
     * Same latest-five selection as myFit, retaining session distances for Riegel conversion. Short sessions (under 1 km
     * or 10 moving minutes, S15P31E105-785/886) are not records, so a runner with only those counts as no-record and
     * goes to AI09, which plans them from the signup baseline (cold start) like a personal run.
     */
    public List<BigDecimal> recentPaces(long userId, int distanceM) {
        return jdbc.query("""
                SELECT average_pace, total_distance FROM running_sessions
                WHERE user_id = ? AND status = 'COMPLETED' AND deleted_at IS NULL
                    AND average_pace > 0 AND total_distance > 0
                    AND total_distance >= ? AND moving_duration >= ?
                    AND average_pace NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
                    AND total_distance NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
                ORDER BY COALESCE(ended_at, started_at) DESC NULLS LAST, id DESC LIMIT 5
                """, (rs, n) -> BigDecimal.valueOf(rs.getDouble("average_pace")
                        * Math.pow(distanceM / rs.getDouble("total_distance"), 0.06)), userId,
                GroupRunFitCalculator.MIN_SESSION_DISTANCE_M, GroupRunFitCalculator.MIN_SESSION_MOVING_SEC);
    }
}
