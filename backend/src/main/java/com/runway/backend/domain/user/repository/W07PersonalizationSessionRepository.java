package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.user.personalization.W07MetricSample;
import com.runway.backend.domain.user.personalization.W07RoutePoint;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 심박 개인화(AI06) 입력용 W07 읽기 전용 저장소. 트랜잭션 없이 단건씩 읽는다(AI HTTP 호출은 트랜잭션 밖).
 *
 * <p>직접 SQL을 쓰는 이유: PostGIS {@code geography}에서 경도·위도를 꺼내고 {@code user_devices}를 LEFT JOIN해 기기 종류를 붙이는
 * 읽기 전용 조인이다. 값은 바인딩 파라미터로만 전달한다.
 */
@Repository
@RequiredArgsConstructor
public class W07PersonalizationSessionRepository {

    private final JdbcTemplate jdbc;

    /** 완료 러닝 목록의 한 줄. 표본은 {@link #findSamples(long)}으로 따로 읽는다. */
    public record SessionHeader(long sessionId, Instant startedAt) {}

    /** 세션의 소유 회원. 없는 세션이면 빈 값(삭제된 세션 포함하지 않는 조건은 두지 않는다). */
    public Optional<Long> findUserIdBySessionId(long sessionId) {
        return jdbc
                .query(
                        "SELECT user_id FROM running_sessions WHERE id = ?",
                        (rs, n) -> rs.getLong("user_id"),
                        sessionId)
                .stream()
                .findFirst();
    }

    /**
     * 회원의 COMPLETED·미삭제 러닝을 시작 최신순으로 읽는다. 변환에 실패하는 러닝이 있어도 50개를 채울 수 있도록 호출자가 여유 있는 {@code limit}을 넘긴다.
     */
    public List<SessionHeader> findCompletedSessions(long userId, int limit) {
        return jdbc.query(
                """
                SELECT id, started_at
                  FROM running_sessions
                 WHERE user_id = ? AND status = 'COMPLETED' AND deleted_at IS NULL
                   AND started_at IS NOT NULL
                 ORDER BY started_at DESC, id DESC
                 LIMIT ?
                """,
                (rs, n) ->
                        new SessionHeader(
                                rs.getLong("id"),
                                rs.getObject("started_at", OffsetDateTime.class).toInstant()),
                userId,
                limit);
    }

    /** 세션의 지표 샘플(시각 오름차순). */
    public List<W07MetricSample> findSamples(long sessionId) {
        return jdbc.query(
                """
                SELECT measured_at, heart_rate, is_hr_measured, total_distance, speed
                  FROM running_metric_samples
                 WHERE running_session_id = ?
                 ORDER BY measured_at, id
                """,
                (rs, n) ->
                        new W07MetricSample(
                                rs.getObject("measured_at", OffsetDateTime.class).toInstant(),
                                nullableDouble(rs, "heart_rate"),
                                rs.getBoolean("is_hr_measured"),
                                nullableDouble(rs, "total_distance"),
                                nullableDouble(rs, "speed")),
                sessionId);
    }

    /** 세션의 경로점(시각 오름차순). 기기가 없으면 PHONE이다. */
    public List<W07RoutePoint> findRoutePoints(long sessionId) {
        return jdbc.query(
                """
                SELECT p.measured_at,
                       ST_X(p.position::geometry) AS lon,
                       ST_Y(p.position::geometry) AS lat,
                       COALESCE(d.device_type::text, 'PHONE') AS device_type
                  FROM running_route_points p
                  LEFT JOIN user_devices d ON d.id = p.device_id
                 WHERE p.running_session_id = ?
                 ORDER BY p.measured_at, p.id
                """,
                (rs, n) ->
                        new W07RoutePoint(
                                rs.getObject("measured_at", OffsetDateTime.class).toInstant(),
                                rs.getDouble("lon"),
                                rs.getDouble("lat"),
                                W07RoutePoint.DeviceType.fromDb(rs.getString("device_type"))),
                sessionId);
    }

    private static Double nullableDouble(ResultSet rs, String column) throws SQLException {
        double value = rs.getDouble(column);
        return rs.wasNull() ? null : value;
    }
}
