package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.service.RunningRouteSelector.RoutePoint;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * S11 경로 조회가 읽는 W07 GPS 위치(running_route_points). 테이블에 Entity가 없어 기존 분석 조회처럼 JDBC로 읽고 호출자 트랜잭션을 쓴다.
 * 기기 정보가 없는 위치는 PHONE으로 본다(개인화 변환기와 같은 기준).
 */
@Repository
public class SessionRouteRepository {

    private final JdbcTemplate jdbc;

    public SessionRouteRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 실제 시작 이후(종료했으면 종료 시각까지)의 위치를 측정시각·ID 순으로 읽는다. */
    public List<RoutePoint> findPoints(long sessionId, Instant startedAt, Instant endedAt) {
        Timestamp until = endedAt == null ? null : Timestamp.from(endedAt);
        return jdbc.query(
                """
                SELECT p.measured_at,
                       ST_X(p.position::geometry) AS lon,
                       ST_Y(p.position::geometry) AS lat,
                       p.accuracy,
                       COALESCE(d.device_type::text, 'PHONE') AS device_type
                  FROM running_route_points p
                  LEFT JOIN user_devices d ON d.id = p.device_id
                 WHERE p.running_session_id = ?
                   AND p.measured_at >= ?
                   AND (CAST(? AS timestamptz) IS NULL OR p.measured_at <= CAST(? AS timestamptz))
                 ORDER BY p.measured_at, p.id
                """,
                (rs, n) ->
                        new RoutePoint(
                                rs.getObject("measured_at", OffsetDateTime.class).toInstant(),
                                rs.getDouble("lon"),
                                rs.getDouble("lat"),
                                rs.getBigDecimal("accuracy"),
                                rs.getString("device_type")),
                sessionId,
                Timestamp.from(startedAt),
                until,
                until);
    }
}
