package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.entity.AnalysisSplit;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 종료 후 분석(S15P31E105-312)이 읽는 W07 원본 샘플과 쓰는 1km 구간 저장소.
 *
 * <p>구간 테이블에는 Entity가 없고 기존 기록 조회도 JDBC를 쓰므로 같은 방식으로 다룬다. 호출자의 트랜잭션 커넥션을 그대로 사용하므로 세션 통계 저장과
 * 한 트랜잭션이다.
 */
@Repository
public class SessionAnalysisRepository {

    private final JdbcTemplate jdbc;

    public SessionAnalysisRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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
