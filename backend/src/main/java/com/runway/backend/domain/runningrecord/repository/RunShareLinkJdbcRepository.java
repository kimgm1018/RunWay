package com.runway.backend.domain.runningrecord.repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** run_share_links(V37) 저장·조회. 토큰·좌표는 로그에 남기지 않는다. */
@Repository
public class RunShareLinkJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public RunShareLinkJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 세션의 링크가 없으면 새 token으로 만들고, 있으면 제목만 바꾼다. session_id UNIQUE 충돌(동시 첫 발급 포함)은 ON CONFLICT로 받아
     * 예외 없이 기존 행을 갱신하므로 트랜잭션이 중단되지 않는다. 제목이 같으면 행을 고치지 않고 빈 값을 돌려준다.
     */
    public Optional<String> upsert(long sessionId, long userId, String newToken, String title) {
        List<String> tokens =
                jdbcTemplate.queryForList(
                        """
                        INSERT INTO run_share_links(session_id, user_id, token, title)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT (session_id) DO UPDATE SET title = EXCLUDED.title
                        WHERE run_share_links.title IS DISTINCT FROM EXCLUDED.title
                        RETURNING token
                        """,
                        String.class,
                        sessionId,
                        userId,
                        newToken,
                        title);
        return tokens.stream().findFirst();
    }

    public Optional<String> findTokenBySessionId(long sessionId) {
        return jdbcTemplate
                .queryForList(
                        "SELECT token FROM run_share_links WHERE session_id = ?",
                        String.class,
                        sessionId)
                .stream()
                .findFirst();
    }

    /** 토큰의 기록을 읽는다. 완료(COMPLETED)가 아니거나 삭제된 기록, ACTIVE가 아닌 발급자의 링크는 찾지 못한 것으로 본다. */
    public Optional<SharedRunRow> findVisibleByToken(String token) {
        return jdbcTemplate
                .query(
                        """
                        SELECT l.title,
                               s.id AS session_id,
                               s.started_at,
                               s.ended_at,
                               s.total_distance,
                               s.moving_duration,
                               s.average_pace,
                               s.average_cadence,
                               u.nickname,
                               u.profile_image_key
                          FROM run_share_links l
                          JOIN running_sessions s ON s.id = l.session_id
                          JOIN users u ON u.id = l.user_id
                         WHERE l.token = ?
                           AND s.user_id = l.user_id
                           AND s.status = 'COMPLETED'::running_sessions_status_enum
                           AND s.deleted_at IS NULL
                           AND u.account_status = 'ACTIVE'
                           AND u.withdrawn_at IS NULL
                        """,
                        (rs, n) ->
                                new SharedRunRow(
                                        rs.getString("title"),
                                        rs.getLong("session_id"),
                                        toInstant(rs.getTimestamp("started_at")),
                                        toInstant(rs.getTimestamp("ended_at")),
                                        rs.getBigDecimal("total_distance"),
                                        (Integer) rs.getObject("moving_duration"),
                                        rs.getBigDecimal("average_pace"),
                                        rs.getBigDecimal("average_cadence"),
                                        rs.getString("nickname"),
                                        rs.getString("profile_image_key")),
                        token)
                .stream()
                .findFirst();
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record SharedRunRow(
            String title,
            long sessionId,
            Instant startedAt,
            Instant endedAt,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace,
            BigDecimal averageCadence,
            String nickname,
            String profileImageKey) {}
}
