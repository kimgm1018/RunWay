package com.runway.backend.domain.runningrecord.repository;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RunningRecordJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public RunningRecordJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean existsUserById(long userId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM users WHERE id = ?", Integer.class, userId);
        return count != null && count > 0;
    }

    public Optional<SessionRow> findSessionById(long sessionId) {
        List<SessionRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT id,
                               user_id,
                               course_id,
                               comparison_session_id,
                               status::text AS status,
                               goal_distance,
                               goal_duration,
                               goal_pace,
                               started_at,
                               ended_at,
                               total_distance,
                               moving_duration,
                               elapsed_duration,
                               goal_achieved,
                               average_pace,
                               average_heart_rate,
                               average_cadence,
                               deleted_at
                        FROM running_sessions
                        WHERE id = ?
                        """,
                        (rs, rowNum) -> mapSessionRow(rs),
                        sessionId);
        return rows.stream().findFirst();
    }

    public List<ListItemRow> findCompletedRecords(
            long userId,
            Instant fromInclusive,
            Instant toExclusive,
            Long courseId,
            RunTypeFilter runType,
            SortType sort,
            ListCursor cursor,
            int limit) {
        StringBuilder sql =
                new StringBuilder(
                        """
                        SELECT rs.id,
                               rs.course_id,
                               rs.started_at,
                               rs.total_distance,
                               rs.moving_duration,
                               rs.average_pace,
                               rs.goal_achieved,
                               gl.group_run_id,
                               gl.crew_name,
                               gl.finisher_count
                        FROM running_sessions rs
                        LEFT JOIN LATERAL (
                            SELECT grp.group_run_id AS group_run_id,
                                   c.name AS crew_name,
                                   (SELECT COUNT(*)
                                      FROM group_run_participants fp
                                      JOIN running_sessions fs ON fs.id = fp.session_id
                                     WHERE fp.group_run_id = grp.group_run_id
                                       AND fs.goal_achieved = TRUE) AS finisher_count
                              FROM group_run_participants grp
                              JOIN group_runs gr ON gr.id = grp.group_run_id
                              JOIN crews c ON c.id = gr.crew_id
                             WHERE grp.session_id = rs.id
                             ORDER BY grp.id
                             LIMIT 1
                        ) gl ON TRUE
                        WHERE rs.user_id = ?
                          AND rs.status = 'COMPLETED'::running_sessions_status_enum
                          AND rs.deleted_at IS NULL
                        """);
        List<Object> args = new ArrayList<>();
        args.add(userId);

        if (fromInclusive != null) {
            // from inclusive: started_at >= from
            sql.append(" AND rs.started_at >= ?");
            args.add(Timestamp.from(fromInclusive));
        }
        if (toExclusive != null) {
            // to exclusive: started_at < to
            sql.append(" AND rs.started_at < ?");
            args.add(Timestamp.from(toExclusive));
        }
        if (courseId != null) {
            sql.append(" AND rs.course_id = ?");
            args.add(courseId);
        }

        switch (runType) {
            case SOLO ->
                    sql.append(
                            """
                             AND NOT EXISTS (
                               SELECT 1 FROM group_run_participants grp
                               WHERE grp.session_id = rs.id
                             )
                            """);
            case GROUP ->
                    sql.append(
                            """
                             AND EXISTS (
                               SELECT 1 FROM group_run_participants grp
                               WHERE grp.session_id = rs.id
                             )
                            """);
            case ALL -> {
                // no extra filter
            }
        }

        appendCursorPredicate(sql, args, sort, cursor);
        appendOrderBy(sql, sort);
        sql.append(" LIMIT ?");
        args.add(limit);

        return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapListItemRow(rs), args.toArray());
    }

    public List<SplitRow> findSplitsBySessionId(long sessionId) {
        return jdbcTemplate.query(
                """
                SELECT start_distance,
                       end_distance,
                       pace,
                       average_heart_rate,
                       average_cadence
                FROM running_session_splits
                WHERE running_session_id = ?
                ORDER BY start_distance ASC
                """,
                (rs, rowNum) ->
                        new SplitRow(
                                rs.getBigDecimal("start_distance"),
                                rs.getBigDecimal("end_distance"),
                                rs.getBigDecimal("pace"),
                                rs.getBigDecimal("average_heart_rate"),
                                rs.getBigDecimal("average_cadence")),
                sessionId);
    }

    /**
     * H06/H07용 COMPLETED·미삭제 세션 집계 행. {@code started_at}은 {@code [fromInclusive,
     * toExclusive)}.
     */
    public List<StatsSessionRow> findStatsSessions(
            long userId,
            Instant fromInclusive,
            Instant toExclusive,
            RunTypeFilter runType) {
        StringBuilder sql =
                new StringBuilder(
                        """
                        SELECT rs.id,
                               rs.started_at,
                               rs.total_distance,
                               rs.moving_duration,
                               rs.average_pace
                        FROM running_sessions rs
                        WHERE rs.user_id = ?
                          AND rs.status = 'COMPLETED'::running_sessions_status_enum
                          AND rs.deleted_at IS NULL
                          AND rs.started_at >= ?
                          AND rs.started_at < ?
                        """);
        List<Object> args = new ArrayList<>();
        args.add(userId);
        args.add(Timestamp.from(fromInclusive));
        args.add(Timestamp.from(toExclusive));
        appendRunTypeFilter(sql, runType);
        sql.append(" ORDER BY rs.started_at ASC, rs.id ASC");
        return jdbcTemplate.query(
                sql.toString(), (rs, rowNum) -> mapStatsSessionRow(rs), args.toArray());
    }

    /** 기간 내 세션의 측정 심박(null 제외). */
    public List<BigDecimal> findHeartRateSamplesInPeriod(
            long userId,
            Instant fromInclusive,
            Instant toExclusive,
            RunTypeFilter runType) {
        StringBuilder sql =
                new StringBuilder(
                        """
                        SELECT rms.heart_rate
                        FROM running_metric_samples rms
                        INNER JOIN running_sessions rs ON rs.id = rms.running_session_id
                        WHERE rs.user_id = ?
                          AND rs.status = 'COMPLETED'::running_sessions_status_enum
                          AND rs.deleted_at IS NULL
                          AND rs.started_at >= ?
                          AND rs.started_at < ?
                          AND rms.heart_rate IS NOT NULL
                        """);
        List<Object> args = new ArrayList<>();
        args.add(userId);
        args.add(Timestamp.from(fromInclusive));
        args.add(Timestamp.from(toExclusive));
        appendRunTypeFilter(sql, runType);
        return jdbcTemplate.query(
                sql.toString(), (rs, rowNum) -> rs.getBigDecimal("heart_rate"), args.toArray());
    }

    /**
     * {@code metric_date <= baseDate} 이면서 해당 컬럼이 있는 최근 행. 없으면 empty.
     */
    public Optional<BigDecimal> findHealthMetricOnOrBefore(
            long userId, LocalDate baseDate, String column) {
        requireHealthMetricColumn(column);
        List<BigDecimal> rows =
                jdbcTemplate.query(
                        """
                        SELECT %s AS value
                        FROM daily_health_metrics
                        WHERE user_id = ?
                          AND metric_date <= ?
                          AND %s IS NOT NULL
                        ORDER BY metric_date DESC
                        LIMIT 1
                        """
                                .formatted(column, column),
                        (rs, rowNum) -> rs.getBigDecimal("value"),
                        userId,
                        Date.valueOf(baseDate));
        return rows.stream().findFirst();
    }

    /** 해당 컬럼이 있는 전체 기간 중 최신 행. */
    public Optional<BigDecimal> findLatestHealthMetric(long userId, String column) {
        requireHealthMetricColumn(column);
        List<BigDecimal> rows =
                jdbcTemplate.query(
                        """
                        SELECT %s AS value
                        FROM daily_health_metrics
                        WHERE user_id = ?
                          AND %s IS NOT NULL
                        ORDER BY metric_date DESC
                        LIMIT 1
                        """
                                .formatted(column, column),
                        (rs, rowNum) -> rs.getBigDecimal("value"),
                        userId);
        return rows.stream().findFirst();
    }

    public Optional<LocalDate> findBirthDate(long userId) {
        List<LocalDate> rows =
                jdbcTemplate.query(
                        "SELECT birth_date FROM users WHERE id = ?",
                        (rs, rowNum) -> rs.getDate("birth_date").toLocalDate(),
                        userId);
        return rows.stream().findFirst();
    }

    private static void appendRunTypeFilter(StringBuilder sql, RunTypeFilter runType) {
        switch (runType) {
            case SOLO ->
                    sql.append(
                            """
                             AND NOT EXISTS (
                               SELECT 1 FROM group_run_participants grp
                               WHERE grp.session_id = rs.id
                             )
                            """);
            case GROUP ->
                    sql.append(
                            """
                             AND EXISTS (
                               SELECT 1 FROM group_run_participants grp
                               WHERE grp.session_id = rs.id
                             )
                            """);
            case ALL -> {
                // no extra filter
            }
        }
    }

    private static void requireHealthMetricColumn(String column) {
        if (!"max_heart_rate".equals(column) && !"rhr_bpm".equals(column)) {
            throw new IllegalArgumentException("unsupported health metric column: " + column);
        }
    }

    private static StatsSessionRow mapStatsSessionRow(ResultSet rs) throws SQLException {
        return new StatsSessionRow(
                rs.getLong("id"),
                toInstant(rs.getTimestamp("started_at")),
                rs.getBigDecimal("total_distance"),
                getNullableInteger(rs, "moving_duration"),
                rs.getBigDecimal("average_pace"));
    }

    private static void appendOrderBy(StringBuilder sql, SortType sort) {
        switch (sort) {
            case LATEST ->
                    sql.append(" ORDER BY rs.started_at DESC NULLS LAST, rs.id DESC");
            case DISTANCE ->
                    sql.append(" ORDER BY rs.total_distance DESC NULLS LAST, rs.id DESC");
            case PACE -> sql.append(" ORDER BY rs.average_pace ASC NULLS LAST, rs.id DESC");
        }
    }

    /**
     * Keyset after the cursor row. Tie-break is always {@code id DESC}. NULLS LAST semantics match
     * the ORDER BY clauses.
     */
    private static void appendCursorPredicate(
            StringBuilder sql, List<Object> args, SortType sort, ListCursor cursor) {
        if (cursor == null) {
            return;
        }
        switch (sort) {
            case LATEST -> appendInstantCursor(sql, args, "rs.started_at", cursor.instantValue(), cursor.id());
            case DISTANCE ->
                    appendNumericCursorDesc(
                            sql, args, "rs.total_distance", cursor.decimalValue(), cursor.id());
            case PACE ->
                    appendNumericCursorAsc(
                            sql, args, "rs.average_pace", cursor.decimalValue(), cursor.id());
        }
    }

    private static void appendInstantCursor(
            StringBuilder sql, List<Object> args, String column, Instant value, long id) {
        if (value != null) {
            Timestamp ts = Timestamp.from(value);
            sql.append(
                    """
                     AND (
                       %s < ?
                       OR (%s = ? AND rs.id < ?)
                       OR %s IS NULL
                     )
                    """
                            .formatted(column, column, column));
            args.add(ts);
            args.add(ts);
            args.add(id);
        } else {
            sql.append(" AND ").append(column).append(" IS NULL AND rs.id < ?");
            args.add(id);
        }
    }

    private static void appendNumericCursorDesc(
            StringBuilder sql, List<Object> args, String column, BigDecimal value, long id) {
        if (value != null) {
            sql.append(
                    """
                     AND (
                       %s < ?
                       OR (%s = ? AND rs.id < ?)
                       OR %s IS NULL
                     )
                    """
                            .formatted(column, column, column));
            args.add(value);
            args.add(value);
            args.add(id);
        } else {
            sql.append(" AND ").append(column).append(" IS NULL AND rs.id < ?");
            args.add(id);
        }
    }

    private static void appendNumericCursorAsc(
            StringBuilder sql, List<Object> args, String column, BigDecimal value, long id) {
        if (value != null) {
            sql.append(
                    """
                     AND (
                       %s > ?
                       OR (%s = ? AND rs.id < ?)
                       OR %s IS NULL
                     )
                    """
                            .formatted(column, column, column));
            args.add(value);
            args.add(value);
            args.add(id);
        } else {
            sql.append(" AND ").append(column).append(" IS NULL AND rs.id < ?");
            args.add(id);
        }
    }

    private static SessionRow mapSessionRow(ResultSet rs) throws SQLException {
        return new SessionRow(
                rs.getLong("id"),
                rs.getLong("user_id"),
                getNullableLong(rs, "course_id"),
                getNullableLong(rs, "comparison_session_id"),
                rs.getString("status"),
                getNullableInteger(rs, "goal_distance"),
                getNullableInteger(rs, "goal_duration"),
                rs.getBigDecimal("goal_pace"),
                toInstant(rs.getTimestamp("started_at")),
                toInstant(rs.getTimestamp("ended_at")),
                rs.getBigDecimal("total_distance"),
                getNullableInteger(rs, "moving_duration"),
                getNullableInteger(rs, "elapsed_duration"),
                getNullableBoolean(rs, "goal_achieved"),
                rs.getBigDecimal("average_pace"),
                rs.getBigDecimal("average_heart_rate"),
                rs.getBigDecimal("average_cadence"),
                toInstant(rs.getTimestamp("deleted_at")));
    }

    private static ListItemRow mapListItemRow(ResultSet rs) throws SQLException {
        return new ListItemRow(
                rs.getLong("id"),
                getNullableLong(rs, "course_id"),
                toInstant(rs.getTimestamp("started_at")),
                rs.getBigDecimal("total_distance"),
                getNullableInteger(rs, "moving_duration"),
                rs.getBigDecimal("average_pace"),
                getNullableBoolean(rs, "goal_achieved"),
                getNullableLong(rs, "group_run_id"),
                rs.getString("crew_name"),
                getNullableInteger(rs, "finisher_count"));
    }

    private static Long getNullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private static Integer getNullableInteger(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static Boolean getNullableBoolean(ResultSet rs, String column) throws SQLException {
        boolean value = rs.getBoolean(column);
        return rs.wasNull() ? null : value;
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public enum RunTypeFilter {
        ALL,
        SOLO,
        GROUP
    }

    public enum SortType {
        LATEST,
        DISTANCE,
        PACE
    }

    /** Opaque list cursor payload after Base64 decode (sort must match the request). */
    public record ListCursor(
            SortType sort, Instant instantValue, BigDecimal decimalValue, long id) {

        public static ListCursor forLatest(Instant startedAt, long id) {
            return new ListCursor(SortType.LATEST, startedAt, null, id);
        }

        public static ListCursor forDistance(BigDecimal totalDistance, long id) {
            return new ListCursor(SortType.DISTANCE, null, totalDistance, id);
        }

        public static ListCursor forPace(BigDecimal averagePace, long id) {
            return new ListCursor(SortType.PACE, null, averagePace, id);
        }
    }

    public record SessionRow(
            long id,
            long userId,
            Long courseId,
            Long comparisonSessionId,
            String status,
            Integer goalDistance,
            Integer goalDuration,
            BigDecimal goalPace,
            Instant startedAt,
            Instant endedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            Integer elapsedDuration,
            Boolean goalAchieved,
            BigDecimal averagePace,
            BigDecimal averageHeartRate,
            BigDecimal averageCadence,
            Instant deletedAt) {}

    public record ListItemRow(
            long id,
            Long courseId,
            Instant startedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace,
            Boolean goalAchieved,
            Long groupRunId,
            String crewName,
            Integer finisherCount) {}

    public record SplitRow(
            BigDecimal startDistance,
            BigDecimal endDistance,
            BigDecimal pace,
            BigDecimal averageHeartRate,
            BigDecimal averageCadence) {}

    public record StatsSessionRow(
            long id,
            Instant startedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace) {}
}
