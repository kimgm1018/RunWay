package com.runway.backend.domain.grouprun.repository;

import java.math.BigDecimal;
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

    /** 참가자 온보딩 평균 페이스(sec/km). 양수만. 프로필 없으면 제외. */
    public List<BigDecimal> findParticipantProfilePaces(long groupRunId) {
        return jdbcTemplate.query(
                """
                SELECT up.average_pace
                FROM group_run_participants p
                INNER JOIN user_profiles up ON up.user_id = p.user_id
                WHERE p.group_run_id = ?
                  AND up.average_pace IS NOT NULL
                  AND up.average_pace > 0
                  AND up.average_pace NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
                ORDER BY p.joined_at ASC, p.id ASC
                """,
                (rs, rowNum) -> rs.getBigDecimal("average_pace"),
                groupRunId);
    }

    /**
     * RUNNING 세션 참가자의 추천/실측 페이스. AI04 coaching 최신 recommended_pace 우선, 없으면 최근 60초
     * W07 speed 실측 페이스. 일시정지·종료·미시작은 제외. 종료 후 average_pace는 쓰지 않는다.
     *
     * @param measuredAtCeiling 보통 {@code now + MEASURED_AT_FUTURE_SKEW}
     */
    public List<BigDecimal> findRunningParticipantGuidePaces(
            long groupRunId, Instant measuredAtCeiling) {
        Timestamp ceiling = Timestamp.from(measuredAtCeiling);
        return jdbcTemplate.query(
                """
                SELECT COALESCE(c.recommended_pace, live.pace) AS pace
                FROM group_run_participants p
                INNER JOIN running_sessions s
                  ON s.id = p.session_id AND s.deleted_at IS NULL
                LEFT JOIN LATERAL (
                    SELECT cd.recommended_pace
                    FROM coaching_decisions cd
                    WHERE cd.session_id = s.id
                      AND cd.recommended_pace IS NOT NULL
                      AND cd.recommended_pace > 0
                    ORDER BY cd.id DESC
                    LIMIT 1
                ) c ON TRUE
                LEFT JOIN LATERAL (
                    SELECT (1000.0 / AVG(rms.speed)) AS pace
                    FROM running_metric_samples rms
                    WHERE rms.running_session_id = s.id
                      AND rms.speed IS NOT NULL
                      AND rms.speed > 0
                      AND rms.speed NOT IN (
                          'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
                      AND rms.measured_at <= ?
                      AND rms.measured_at >= (
                          SELECT MAX(x.measured_at)
                          FROM running_metric_samples x
                          WHERE x.running_session_id = s.id
                            AND x.speed IS NOT NULL
                            AND x.speed > 0
                            AND x.measured_at <= ?
                      ) - INTERVAL '60 seconds'
                ) live ON TRUE
                WHERE p.group_run_id = ?
                  AND s.status = 'RUNNING'::running_sessions_status_enum
                  AND COALESCE(c.recommended_pace, live.pace) IS NOT NULL
                  AND COALESCE(c.recommended_pace, live.pace) > 0
                ORDER BY p.joined_at ASC, p.id ASC
                """,
                (rs, rowNum) -> rs.getBigDecimal("pace"),
                ceiling,
                ceiling,
                groupRunId);
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
