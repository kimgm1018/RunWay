package com.runway.backend.domain.community.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
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
     * CMT01 생성·CMT04 수정·CMT05 삭제용. 세션 행을 {@code FOR UPDATE}로 잠가 S09 삭제와 같은 순서로 직렬화한다. 호출 트랜잭션이 끝날 때까지
     * 잠금을 유지한다. 회원 행을 잠그지 않도록 users를 JOIN하지 않으므로 반환값의 평균 심박·케이던스는 항상 null, 작성자 건강정보
     * 동의는 항상 false다. 기록 요약(심박·케이던스) 표시에는 {@link #findByIds}·{@link #findById}를 쓴다.
     */
    public Optional<SessionShareInfo> findByIdForUpdate(long sessionId) {
        return queryById(sessionId, " FOR UPDATE");
    }

    private Optional<SessionShareInfo> queryById(long sessionId, String lockClause) {
        boolean forUpdate = !lockClause.isEmpty();
        return jdbcTemplate
                .query(
                        selectSession(forUpdate) + " WHERE running_sessions.id = ?" + lockClause,
                        (rs, rowNum) -> mapSession(rs),
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
                selectSession(false) + " WHERE running_sessions.id IN (" + placeholders + ")",
                rs -> {
                    SessionShareInfo info = mapSession(rs);
                    sessions.put(info.id(), info);
                },
                args);
        return sessions;
    }

    private static String selectSession(boolean forUpdate) {
        // 쓰기 경로는 기록 요약을 만들지 않으며 세션 잠금 뒤 회원 행을 잠그지 않는다.
        String healthColumns =
                forUpdate
                        ? "NULL AS average_heart_rate, NULL AS average_cadence, false AS author_health_consented"
                        : """
                          running_sessions.average_heart_rate, running_sessions.average_cadence,
                          COALESCE(u.health_data_access = 'AGREE' AND u.account_status = 'ACTIVE', false)
                              AS author_health_consented
                          """;
        return """
                SELECT running_sessions.id, running_sessions.user_id, running_sessions.course_id,
                       running_sessions.status::text AS status, running_sessions.deleted_at,
                       running_sessions.total_distance, running_sessions.moving_duration,
                       running_sessions.average_pace, %s,
                       EXISTS (SELECT 1 FROM courses c
                                WHERE c.id = running_sessions.course_id
                                  AND c.source_session_id = running_sessions.id)
                                   AS course_from_free_run
                FROM running_sessions
                """
                        .formatted(healthColumns)
                + (forUpdate ? "" : " LEFT JOIN users u ON u.id = running_sessions.user_id");
    }

    private static SessionShareInfo mapSession(ResultSet rs) throws SQLException {
        return new SessionShareInfo(
                rs.getLong("id"),
                rs.getLong("user_id"),
                (Long) rs.getObject("course_id"),
                rs.getString("status"),
                toInstant(rs.getTimestamp("deleted_at")),
                rs.getBigDecimal("total_distance"),
                (Integer) rs.getObject("moving_duration"),
                rs.getBigDecimal("average_pace"),
                rs.getBigDecimal("average_heart_rate"),
                rs.getBigDecimal("average_cadence"),
                rs.getBoolean("author_health_consented"),
                rs.getBoolean("course_from_free_run"));
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
            BigDecimal averagePace,
            BigDecimal averageHeartRate,
            BigDecimal averageCadence,
            boolean authorHealthConsented,
            boolean courseFromFreeRun) {

        public boolean isCompleted() {
            return "COMPLETED".equals(status);
        }

        public boolean isDeleted() {
            return deletedAt != null;
        }
    }
}
