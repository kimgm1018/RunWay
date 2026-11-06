package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.coaching.decide.CoachingLevel;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 세션 유스케이스가 참조하는 다른 테이블(회원·코스·그룹런·코칭·게시물)과 DB 잠금 기능을 다룬다.
 *
 * 다른 도메인의 Entity·Repository를 수정하지 않기 위해 필요한 컬럼만 직접 SQL로 읽는다. 행 잠금(FOR SHARE/UPDATE)과
 * advisory lock은 JPA 기본 기능으로 표현하기 어렵다. JPA와 같은 트랜잭션의 커넥션을 사용한다.
 */
@Repository
public class SessionReferenceRepository {

    /** pg_advisory_xact_lock(int,int)의 첫 번째 키. 다른 기능의 advisory lock과 구분한다. */
    static final int SESSION_CREATE_LOCK_NAMESPACE = 255_001;

    private final JdbcTemplate jdbc;

    public SessionReferenceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 탈퇴(WITHDRAWN) 회원은 남은 Access Token이 있어도 세션 API를 사용할 수 없다. */
    public boolean activeUserExists(long userId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM users WHERE id = ? AND account_status = 'ACTIVE')",
                        Boolean.class,
                        userId));
    }

    /**
     * 같은 회원의 세션 생성을 트랜잭션 끝까지 한 줄로 세운다. 회원 ID를 int 범위로 접어 키로 쓰므로 드물게 다른 회원끼리 같이 기다릴 수 있으나 결과는
     * 바뀌지 않는다.
     */
    public void lockSessionCreation(long userId) {
        jdbc.query(
                "SELECT pg_advisory_xact_lock(?, ?)",
                rs -> {},
                SESSION_CREATE_LOCK_NAMESPACE,
                (int) (userId % Integer.MAX_VALUE));
    }

    /** 잠금 없이 존재·삭제·소유자만 확인한다. 잠금 전 그룹 행을 먼저 잠그기 위해 그룹 연결도 함께 읽는다. */
    public Optional<SessionOwnership> findOwnership(long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT s.user_id, s.deleted_at IS NOT NULL AS deleted,
                               (SELECT p.group_run_id FROM group_run_participants p
                                WHERE p.session_id = s.id ORDER BY p.id LIMIT 1) AS group_run_id
                        FROM running_sessions s WHERE s.id = ?
                        """,
                        (rs, n) ->
                                new SessionOwnership(
                                        rs.getLong("user_id"),
                                        rs.getBoolean("deleted"),
                                        (Long) rs.getObject("group_run_id")),
                        sessionId)
                .stream()
                .findFirst();
    }

    /** 세션 행을 잠근 뒤 그룹 연결이 잠금 전 확인과 같은지 다시 읽는다. */
    public Optional<Long> findGroupRunId(long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT group_run_id FROM group_run_participants
                        WHERE session_id = ? ORDER BY id LIMIT 1
                        """,
                        (rs, n) -> rs.getLong("group_run_id"),
                        sessionId)
                .stream()
                .findFirst();
    }

    /** 코스 상태 변경(MERGED·BLOCKED)과 순서를 정하기 위해 FOR SHARE로 잠근다. 커밋 전에 바뀐 상태로 세션을 저장하지 않는다. */
    public Optional<CourseInfo> lockCourse(long courseId) {
        return jdbc
                .query(
                        "SELECT status::text AS status, distance FROM courses WHERE id = ? FOR SHARE",
                        (rs, n) -> new CourseInfo(rs.getString("status"), rs.getBigDecimal("distance")),
                        courseId)
                .stream()
                .findFirst();
    }

    /**
     * 회원에게 연결된 해당 유형 기기 ID를 FOR SHARE로 잠가 읽는다. 그룹 준비 세션 생성 등 기기 ID를 요청으로 받지 않는 경로용이다.
     */
    public Optional<Long> lockLinkedDeviceId(long userId, String deviceType) {
        return jdbc
                .query(
                        """
                        SELECT id FROM user_devices
                        WHERE user_id = ?
                          AND device_type = ?::user_devices_device_type_enum
                          AND unlinked_at IS NULL
                        FOR SHARE
                        """,
                        (rs, n) -> rs.getLong("id"),
                        userId,
                        deviceType)
                .stream()
                .findFirst();
    }

    /** W03 연결 해제와 순서를 정하기 위해 기기 행을 FOR SHARE로 잠근다. 해제가 먼저 확정되면 해제된 상태를 읽는다. */
    public Optional<DeviceRef> lockDevice(long deviceId) {
        return queryDevice(deviceId, " FOR SHARE");
    }

    /** 읽기 전용 확인(REPORT_PREPARED)용. 읽기 전용 트랜잭션에서는 행을 잠글 수 없다. */
    public Optional<DeviceRef> findDevice(long deviceId) {
        return queryDevice(deviceId, "");
    }

    private Optional<DeviceRef> queryDevice(long deviceId, String lockClause) {
        return jdbc
                .query(
                        "SELECT user_id, device_type::text AS device_type, unlinked_at IS NULL AS linked"
                                + " FROM user_devices WHERE id = ?"
                                + lockClause,
                        (rs, n) ->
                                new DeviceRef(
                                        rs.getLong("user_id"),
                                        rs.getString("device_type"),
                                        rs.getBoolean("linked")),
                        deviceId)
                .stream()
                .findFirst();
    }

    /**
     * 비교 기록은 대상 세션 행을 잠근 상태에서 검증·참조한다. S09 삭제와 순서가 정해진다. 다른 회원의 세션 행은 잠그지 않도록 소유자 조건을 잠금 쿼리에
     * 넣는다(타인 세션을 서로 지정해 교차 대기하는 일을 막는다).
     */
    public Optional<ComparisonCandidate> lockComparisonCandidate(long userId, long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT user_id, status::text AS status, course_id, deleted_at IS NOT NULL AS deleted
                        FROM running_sessions WHERE id = ? AND user_id = ? FOR SHARE
                        """,
                        (rs, n) ->
                                new ComparisonCandidate(
                                        rs.getLong("user_id"),
                                        rs.getString("status"),
                                        (Long) rs.getObject("course_id"),
                                        rs.getBoolean("deleted")),
                        sessionId,
                        userId)
                .stream()
                .findFirst();
    }

    /**
     * 그룹 행을 잠가 그룹→세션 순서를 지킨다. 그룹 행을 지우거나 키를 바꾸지 않으므로 FOR NO KEY UPDATE면 충분하다. FOR UPDATE는 참가 행 INSERT의 FK
     * 검사(FOR KEY SHARE)까지 막아 같은 그룹 참가 신청을 불필요하게 기다리게 한다.
     */
    public Optional<GroupRunState> lockGroupRun(long groupRunId) {
        return jdbc
                .query(
                        "SELECT status::text AS status, ended_at FROM group_runs WHERE id = ? FOR NO KEY UPDATE",
                        (rs, n) ->
                                new GroupRunState(
                                        rs.getString("status"), toInstant(rs, "ended_at")),
                        groupRunId)
                .stream()
                .findFirst();
    }

    /** 종료된 그룹런이면 그룹 종료 기준시각, 개인런·미종료 그룹런이면 빈 값이다. */
    public Optional<Instant> findGroupEndedAt(long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT g.ended_at FROM group_run_participants p
                        JOIN group_runs g ON g.id = p.group_run_id
                        WHERE p.session_id = ? AND g.status = 'COMPLETED' AND g.ended_at IS NOT NULL
                        ORDER BY p.id LIMIT 1
                        """,
                        (rs, n) -> toInstant(rs, "ended_at"),
                        sessionId)
                .stream()
                .findFirst();
    }

    /** G14 분석 상태는 저장하지 않으므로, 실제 시작한 참가자 세션의 분석이 모두 끝났는지로 판단한다. */
    public boolean groupAnalysisSettled(long groupRunId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        """
                        SELECT NOT EXISTS (
                            SELECT 1 FROM group_run_participants p
                            JOIN running_sessions s ON s.id = p.session_id
                            WHERE p.group_run_id = ? AND s.started_at IS NOT NULL
                              AND s.analysis_status NOT IN ('READY','FAILED','LEGACY'))
                        """,
                        Boolean.class,
                        groupRunId));
    }

    /**
     * G14 결과 조회용 읽기 전용 조회. 모든 참가자를 가입 순서로 돌려주고, 연결 세션이 없으면 세션 관련 값은 null이다. 삭제 표시된 세션도 참가 관계·집계
     * 원본을 보존하므로 제외하지 않는다. START 결과는 세션의 첫 START 명령(G09가 만든 명령) 기준이다.
     */
    public List<GroupResultRow> findGroupResultRows(long groupRunId) {
        return jdbc.query(
                """
                SELECT p.user_id, p.session_id,
                       s.status::text AS session_status,
                       s.started_at,
                       s.analysis_status::text AS analysis_status,
                       s.total_distance, s.moving_duration, s.average_pace, s.goal_achieved,
                       (SELECT e.result::text FROM session_control_events e
                        WHERE e.session_id = s.id AND e.action = 'START'::session_control_events_action_enum
                        ORDER BY e.id LIMIT 1) AS start_result
                FROM group_run_participants p
                LEFT JOIN running_sessions s ON s.id = p.session_id
                WHERE p.group_run_id = ?
                ORDER BY p.joined_at, p.id
                """,
                (rs, n) ->
                        new GroupResultRow(
                                rs.getLong("user_id"),
                                (Long) rs.getObject("session_id"),
                                rs.getString("session_status"),
                                toInstant(rs, "started_at"),
                                rs.getString("analysis_status"),
                                rs.getBigDecimal("total_distance"),
                                (Integer) rs.getObject("moving_duration"),
                                rs.getBigDecimal("average_pace"),
                                (Boolean) rs.getObject("goal_achieved"),
                                rs.getString("start_result")),
                groupRunId);
    }

    /**
     * G10 실시간 순위용 읽기 전용 조회. 모든 참가자를 가입 순서로 돌려주고, 세션별로 누적 거리가 있는 가장 최근 <b>허용 시각
     * 이하</b> 측정 표본(W07) 하나만 읽는다. {@code measuredAtCeiling}보다 미래인 표본은 고르지 않아 이후 정상 표본이 가려지지
     * 않게 한다. 연결 세션이 없거나 삭제 표시된 세션, 유효 표본이 없는 세션의 값은 null이다. 쓰기·잠금을 하지 않는다.
     *
     * @param measuredAtCeiling 보통 {@code now + MEASURED_AT_FUTURE_SKEW}
     */
    public List<GroupLiveRow> findGroupLiveRows(long groupRunId, Instant measuredAtCeiling) {
        return jdbc.query(
                """
                SELECT p.user_id, s.status::text AS session_status, s.started_at,
                       s.average_pace, m.total_distance, m.measured_at
                FROM group_run_participants p
                LEFT JOIN running_sessions s ON s.id = p.session_id AND s.deleted_at IS NULL
                LEFT JOIN LATERAL (
                    SELECT rms.total_distance, rms.measured_at
                    FROM running_metric_samples rms
                    WHERE rms.running_session_id = s.id
                      AND rms.total_distance IS NOT NULL
                      AND rms.measured_at <= ?
                    ORDER BY rms.measured_at DESC, rms.id DESC
                    LIMIT 1) m ON TRUE
                WHERE p.group_run_id = ?
                ORDER BY p.joined_at, p.id
                """,
                (rs, n) ->
                        new GroupLiveRow(
                                rs.getLong("user_id"),
                                rs.getString("session_status"),
                                toInstant(rs, "started_at"),
                                rs.getBigDecimal("total_distance"),
                                toInstant(rs, "measured_at"),
                                rs.getBigDecimal("average_pace")),
                Timestamp.from(measuredAtCeiling),
                groupRunId);
    }

    public Optional<CoachingGuideRow> findCoachingGuide(long sessionId, long coachingId) {
        return jdbc
                .query(
                        """
                        SELECT recommended_pace, expires_at, coaching_level FROM coaching_decisions
                        WHERE session_id = ? AND id = ?
                        """,
                        (rs, n) ->
                                new CoachingGuideRow(
                                        rs.getBigDecimal("recommended_pace"),
                                        toInstant(rs, "expires_at"),
                                        coachingLevel(rs.getString("coaching_level"))),
                        sessionId,
                        coachingId)
                .stream()
                .findFirst();
    }

    private static CoachingLevel coachingLevel(String value) {
        if (value == null) {
            return null;
        }
        return CoachingLevel.valueOf(value);
    }

    /** 세션에 연결된 게시물을 ID 순서로 잠근다. 세션 → 게시물 순서는 공유 게시물 생성(CMT01)과 같다. */
    public List<PostRef> lockPostsOfSession(long sessionId) {
        return jdbc.query(
                "SELECT id, author_id FROM posts WHERE session_id = ? ORDER BY id FOR UPDATE",
                (rs, n) -> new PostRef(rs.getLong("id"), rs.getLong("author_id")),
                sessionId);
    }

    /** 이미 삭제된 게시물의 삭제 시각은 바꾸지 않는다. */
    public int markPostsDeleted(long sessionId, long authorId, Instant deletedAt) {
        return jdbc.update(
                """
                UPDATE posts SET deleted_at = ?, updated_at = ?
                WHERE session_id = ? AND author_id = ? AND deleted_at IS NULL
                """,
                Timestamp.from(deletedAt),
                Timestamp.from(deletedAt),
                sessionId,
                authorId);
    }

    private static Instant toInstant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    public record SessionOwnership(long userId, boolean deleted, Long groupRunId) {}

    public record CourseInfo(String status, BigDecimal distanceM) {

        public boolean isActive() {
            return "ACTIVE".equals(status);
        }
    }

    public record DeviceRef(long userId, String deviceType, boolean linked) {}

    public record ComparisonCandidate(
            long userId, String status, Long courseId, boolean deleted) {}

    public record GroupRunState(String status, Instant endedAt) {

        public boolean isCompleted() {
            return "COMPLETED".equals(status);
        }
    }

    public record GroupResultRow(
            long userId,
            Long sessionId,
            String sessionStatus,
            Instant startedAt,
            String analysisStatus,
            BigDecimal totalDistance,
            Integer movingDuration,
            BigDecimal averagePace,
            Boolean goalAchieved,
            String startResult) {}

    public record GroupLiveRow(
            long userId,
            String sessionStatus,
            Instant startedAt,
            BigDecimal totalDistance,
            Instant measuredAt,
            BigDecimal averagePaceSecPerKm) {}

    public record CoachingGuideRow(
            BigDecimal recommendedPace, Instant expiresAt, CoachingLevel coachingLevel) {}

    public record PostRef(long id, long authorId) {}
}
