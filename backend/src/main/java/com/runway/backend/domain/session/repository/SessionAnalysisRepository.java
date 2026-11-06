package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.entity.AnalysisSplit;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 종료 후 분석(S15P31E105-312)이 읽는 W07 원본 샘플과 쓰는 1km 구간 저장소.
 *
 * <p>구간 테이블에는 Entity가 없고 기존 기록 조회도 JDBC를 쓰므로 같은 방식으로 다룬다. 호출자의 트랜잭션 커넥션을 그대로 사용하므로 세션 통계 저장과
 * 한 트랜잭션이다. 캐시 권한 확인 cacheOwnerActive만 기존 조회 스냅샷과 분리된 새 트랜잭션을 사용한다.
 */
@Repository
public class SessionAnalysisRepository {

    private final JdbcTemplate jdbc;

    public SessionAnalysisRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Cache admission must not reuse the caller's older S02/S10 REPEATABLE READ snapshot. */
    @org.springframework.transaction.annotation.Transactional(
            readOnly = true,
            propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW,
            isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED,
            timeout = 2)
    public boolean cacheOwnerActive(long userId, long sessionId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM running_sessions s JOIN users u ON u.id=s.user_id
                    WHERE s.id=? AND s.user_id=? AND s.deleted_at IS NULL
                    AND u.account_status='ACTIVE' AND u.withdrawn_at IS NULL)
                """, Boolean.class, sessionId, userId));
    }

    /** 세션의 측정 샘플을 측정시각 순으로 읽는다. 같은 시각이면 경과시간·ID 순이다. */
    public List<AnalysisSample> findSamples(long sessionId) {
        return jdbc.query(
                """
                SELECT measured_at, total_distance, heart_rate, cadence
                FROM running_metric_samples
                WHERE running_session_id = ?
                ORDER BY measured_at, elapsed_duration, id
                """,
                (rs, n) ->
                        new AnalysisSample(
                                rs.getTimestamp("measured_at").toInstant(),
                                rs.getBigDecimal("total_distance"),
                                rs.getBigDecimal("heart_rate"),
                                rs.getBigDecimal("cadence")),
                sessionId);
    }

    /**
     * 기록 비교(S15P31E105-422)용 누적거리 샘플. 누적거리가 없는 샘플은 곡선에 쓰지 않으므로 읽지 않는다. 정렬은 {@link #findSamples}와 같다.
     */
    public List<AnalysisSample> findDistanceSamples(long sessionId) {
        return jdbc.query(
                """
                SELECT measured_at, total_distance
                FROM running_metric_samples
                WHERE running_session_id = ? AND total_distance IS NOT NULL
                ORDER BY measured_at, elapsed_duration, id
                """,
                (rs, n) ->
                        new AnalysisSample(
                                rs.getTimestamp("measured_at").toInstant(),
                                rs.getBigDecimal("total_distance"),
                                null,
                                null),
                sessionId);
    }

    /** 샘플이 추가됐는지 알기 위한 표식(개수·최대 ID). 늦게 도착한 batch가 있으면 값이 바뀐다. */
    public SampleMark sampleMark(long sessionId) {
        return jdbc.queryForObject(
                """
                SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS max_id
                FROM running_metric_samples
                WHERE running_session_id = ?
                """,
                (rs, n) -> new SampleMark(rs.getLong("cnt"), rs.getLong("max_id")),
                sessionId);
    }

    /**
     * 기록 비교 대상의 현재 상태. 잠그지 않는다(S02 읽기 트랜잭션에서 읽는 표시용 값이며 참조 저장은 S01/S08 검증이 잠근다). 본인 세션이 아니면 빈 값이다.
     */
    public Optional<ComparisonTarget> findComparisonTarget(long userId, long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT status::text AS status, deleted_at IS NOT NULL AS deleted, started_at, ended_at
                        FROM running_sessions WHERE id = ? AND user_id = ?
                        """,
                        (rs, n) ->
                                new ComparisonTarget(
                                        rs.getString("status"),
                                        rs.getBoolean("deleted"),
                                        instant(rs.getTimestamp("started_at")),
                                        instant(rs.getTimestamp("ended_at"))),
                        sessionId,
                        userId)
                .stream()
                .findFirst();
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public record SampleMark(long count, long maxId) {}

    public record ComparisonTarget(String status, boolean deleted, Instant startedAt, Instant endedAt) {}

    /** 기존 구간을 모두 지우고 새로 저장한다. 결과는 원본에서 한 번 계산해 덮어쓰며 가산하지 않는다. */
    public void replaceSplits(long sessionId, List<AnalysisSplit> splits) {
        jdbc.update("DELETE FROM running_session_splits WHERE running_session_id = ?", sessionId);
        if (splits.isEmpty()) {
            return;
        }
        jdbc.batchUpdate(
                """
                INSERT INTO running_session_splits(running_session_id, start_distance, end_distance,
                    pace, average_heart_rate, average_cadence)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                splits,
                splits.size(),
                (ps, split) -> {
                    ps.setLong(1, sessionId);
                    ps.setBigDecimal(2, split.startDistance());
                    ps.setBigDecimal(3, split.endDistance());
                    ps.setBigDecimal(4, split.pace());
                    ps.setBigDecimal(5, split.averageHeartRate());
                    ps.setBigDecimal(6, split.averageCadence());
                });
    }

    /**
     * 서버 재기동으로 끊긴 PROCESSING 분석을 FAILED로 바꾸고 버전을 1 올린다. 자동으로 다시 분석하지 않는다.
     *
     * @return 바뀐 세션 수
     */
    public int failProcessingSessions() {
        return jdbc.update(
                """
                UPDATE running_sessions
                SET analysis_status = 'FAILED', state_version = state_version + 1
                WHERE analysis_status = 'PROCESSING'
                """);
    }
}
