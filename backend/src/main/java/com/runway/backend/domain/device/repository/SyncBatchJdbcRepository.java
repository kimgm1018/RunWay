package com.runway.backend.domain.device.repository;

import com.runway.backend.domain.device.dto.request.SyncBatchRequest.GpsPoint;
import com.runway.backend.domain.device.dto.request.SyncBatchRequest.MetricSample;
import com.runway.backend.global.exception.RetryableSqlStates;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * W07 저장소. 세션 행 잠금과 세 테이블 저장을 JPA와 같은 트랜잭션의 커넥션으로 실행한다. 건강·GPS 값은 바인딩 파라미터로만 전달하고 로그에 남기지
 * 않는다.
 *
 * <p>PostgreSQL 드라이버의 쓰기 오류 메시지에는 바인딩 값(좌표·측정값·해시)이 들어간다("Batch entry 0 INSERT ... VALUES (...)",
 * "Failing row contains (...)"). 공통 오류 처리기가 예외를 원인째 기록하므로, 쓰기 오류는 SQLState만 남긴 새 예외로 바꿔 던진다. 재시도 가능
 * 여부(503/500) 분류는 유지한다.
 */
@Repository
@RequiredArgsConstructor
public class SyncBatchJdbcRepository {

    private final JdbcTemplate jdbc;

    public record UserRef(boolean healthConsented) {}

    public record SessionRef(
            String status, long stateVersion, Long controlDeviceId, Long relayDeviceId) {

        public boolean phoneFallback() {
            return controlDeviceId != null && controlDeviceId.equals(relayDeviceId);
        }
    }

    public record DeviceRef(String deviceType, boolean linked) {}

    public record StoredBatch(Long sessionId, String payloadVersion, String payloadHash, String status) {}

    /**
     * 활성 회원과 현재 건강 동의. 회원 행은 잠그지 않는다. 잠그면 세션 잠금을 기다리는 동안 같은 회원의 로그인·프로필 저장(회원 행 FOR UPDATE, 2초
     * 제한)이 실패하고 회원 → 세션 잠금 순서가 새로 생긴다(2026-11-02 사용자 결정). 동의 변경과의 순서 보장은 W04에서 정한다.
     */
    public Optional<UserRef> findActiveUser(long userId) {
        return db(
                () ->
                        jdbc.query(
                        "SELECT health_data_access = 'AGREEE' AS consented FROM users"
                                + " WHERE id = ? AND account_status = 'ACTIVE'",
                        (rs, n) -> new UserRef(rs.getBoolean("consented")),
                        userId)
                .stream()
                .findFirst());
    }

    /**
     * 본인의 삭제되지 않은 세션 행을 잠근다. 세션 서비스(S06 종료·S08 인계·G12)와 같은 FOR NO KEY UPDATE이므로 이들과 한 번에 하나씩
     * 처리된다. 다른 회원의 세션 행은 잠그지 않도록 소유자 조건을 잠금 쿼리에 넣는다.
     */
    public Optional<SessionRef> lockOwnedSession(long sessionId, long userId) {
        return db(
                () ->
                        jdbc.query(
                        """
                        SELECT status::text AS status, state_version, control_device_id, relay_device_id
                        FROM running_sessions
                        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
                        FOR NO KEY UPDATE
                        """,
                        (rs, n) ->
                                new SessionRef(
                                        rs.getString("status"),
                                        rs.getLong("state_version"),
                                        rs.getObject("control_device_id", Long.class),
                                        rs.getObject("relay_device_id", Long.class)),
                        sessionId,
                        userId)
                .stream()
                .findFirst());
    }

    /**
     * 본인 기기 행을 FOR SHARE로 잠가 W03 해제와 순서를 정한다. 세션 행 다음에 잠가 세션 서비스와 같은 순서를 지킨다. 다른 회원의 기기 행은 잠그지
     * 않도록 소유자 조건을 잠금 쿼리에 넣는다.
     */
    public Optional<DeviceRef> lockOwnedDevice(long deviceId, long userId) {
        return db(
                () ->
                        jdbc.query(
                        "SELECT device_type::text AS device_type, unlinked_at IS NULL AS linked"
                                + " FROM user_devices WHERE id = ? AND user_id = ? FOR SHARE",
                        (rs, n) ->
                                new DeviceRef(
                                        rs.getString("device_type"),
                                        rs.getBoolean("linked")),
                        deviceId,
                        userId)
                .stream()
                .findFirst());
    }

    public Optional<StoredBatch> findBatch(long deviceId, UUID clientBatchId) {
        return db(
                () ->
                        jdbc.query(
                        """
                        SELECT session_id, payload_version, payload_hash, status::text AS status
                        FROM sync_batches WHERE device_id = ? AND client_batch_id = ?
                        """,
                        (rs, n) ->
                                new StoredBatch(
                                        rs.getObject("session_id", Long.class),
                                        rs.getString("payload_version"),
                                        rs.getString("payload_hash"),
                                        rs.getString("status")),
                        deviceId,
                        clientBatchId)
                .stream()
                .findFirst());
    }

    /** 시작 승인 후 결과를 기다리거나 확인하지 못한 START가 있는지. */
    public boolean hasUnconfirmedStart(long sessionId) {
        return Boolean.TRUE.equals(
                db(
                        () ->
                                jdbc.queryForObject(
                        """
                        SELECT EXISTS (SELECT 1 FROM session_control_events
                                       WHERE session_id = ? AND action = 'START'
                                         AND result IN ('PENDING','UNKNOWN'))
                        """,
                        Boolean.class,
                        sessionId)));
    }

    /** 이 세션의 제어 기록이 있는 기기인지. 폰 인계 뒤 이전 워치를 구분한다. */
    public boolean controlledSession(long sessionId, long deviceId) {
        return Boolean.TRUE.equals(
                db(
                        () ->
                                jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM session_control_events"
                                + " WHERE session_id = ? AND device_id = ?)",
                        Boolean.class,
                        sessionId,
                        deviceId)));
    }

    /**
     * 같은 (device_id, client_batch_id)가 이미 있으면 아무것도 하지 않고 false를 반환한다. 진행 중인 다른 트랜잭션과 겹치면 PostgreSQL이
     * 그 트랜잭션의 종료를 기다린 뒤 판정한다. 호출자는 false일 때 저장된 행을 다시 읽어 내용을 비교해야 한다.
     */
    public boolean insertCommitted(
            UUID clientBatchId, long deviceId, long sessionId, String version, String hash) {
        return !db(
                () ->
                        jdbc.queryForList(
                        """
                        INSERT INTO sync_batches(client_batch_id, device_id, session_id, payload_version,
                                                 payload_hash, status, committed_at)
                        VALUES (?, ?, ?, ?, ?, 'COMMITTED', now())
                        ON CONFLICT ON CONSTRAINT uq_sync_batches_device_id_client_batch_id DO NOTHING
                        RETURNING id
                        """,
                        Long.class,
                        clientBatchId,
                        deviceId,
                        sessionId,
                        version,
                        hash))
                .isEmpty();
    }

    public void insertMetricSamples(long sessionId, long deviceId, List<MetricSample> samples) {
        if (samples.isEmpty()) {
            return;
        }
        db(
                () ->
                        jdbc.batchUpdate(
                """
                INSERT INTO running_metric_samples(running_session_id, device_id, measured_at, elapsed_duration,
                    heart_rate, cadence, speed, grade, total_distance, route_progress, is_hr_measured)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                samples,
                samples.size(),
                (ps, s) -> {
                    ps.setLong(1, sessionId);
                    ps.setLong(2, deviceId);
                    ps.setObject(3, OffsetDateTime.ofInstant(s.measuredAt(), ZoneOffset.UTC));
                    ps.setInt(4, s.elapsedDurationSec());
                    ps.setBigDecimal(5, s.heartRateBpm());
                    ps.setBigDecimal(6, s.cadenceSpm());
                    ps.setBigDecimal(7, s.speedMps());
                    ps.setBigDecimal(8, s.gradePercent());
                    ps.setBigDecimal(9, s.totalDistanceM());
                    ps.setBigDecimal(10, s.routeProgressM());
                    ps.setBoolean(11, s.isHrMeasured());
                }));
    }

    public void insertRoutePoints(long sessionId, long deviceId, List<GpsPoint> points) {
        if (points.isEmpty()) {
            return;
        }
        db(
                () ->
                        jdbc.batchUpdate(
                """
                INSERT INTO running_route_points(running_session_id, device_id, measured_at, position,
                    accuracy, altitude)
                VALUES (?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?, ?)
                """,
                points,
                points.size(),
                (ps, p) -> {
                    ps.setLong(1, sessionId);
                    ps.setLong(2, deviceId);
                    ps.setObject(3, OffsetDateTime.ofInstant(p.measuredAt(), ZoneOffset.UTC));
                    ps.setDouble(4, p.longitude());
                    ps.setDouble(5, p.latitude());
                    ps.setBigDecimal(6, p.accuracyM());
                    ps.setBigDecimal(7, p.altitudeM());
                }));
    }

    /**
     * DB 오류를 값이 없는 예외로 바꾼다. 원인 예외는 연결하지 않는다(연결하면 원인 메시지가 함께 기록된다).
     *
     * <p>JdbcTemplate은 PostgreSQL의 잠금 대기 초과(55P03)를 분류하지 못하고 UncategorizedSQLException(500)으로 남긴다. 공통 대기
     * 상한(S15P31E105-294)에 걸린 경우를 공통 기준({@link RetryableSqlStates})의 SQLState로 판별해 재시도 가능한 장애(503)로 바꾼다.
     */
    private static <T> T db(Supplier<T> action) {
        try {
            return action.get();
        } catch (DataAccessException e) {
            String sqlState = sqlState(e);
            // 공통 오류 처리기가 이 예외를 한 번 기록한다. 여기서 다시 기록하지 않는다.
            String message =
                    "W07 DB 처리 실패 (SQLState " + sqlState + ", " + e.getClass().getSimpleName() + ")";
            if (e instanceof TransientDataAccessException || RetryableSqlStates.contains(sqlState)) {
                throw new TransientDataAccessResourceException(message);
            }
            if (e instanceof DataAccessResourceFailureException) {
                throw new DataAccessResourceFailureException(message);
            }
            throw new IllegalStateException(message);
        }
    }

    private static String sqlState(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
        }
        return "unknown";
    }
}
