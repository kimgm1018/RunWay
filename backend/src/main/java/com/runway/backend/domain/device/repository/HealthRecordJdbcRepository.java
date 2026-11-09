package com.runway.backend.domain.device.repository;

import com.runway.backend.global.exception.RetryableSqlStates;
import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Optional;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * W06 저장소. 건강 값은 바인딩 파라미터로만 전달하고 로그에 남기지 않는다.
 *
 * <p>PostgreSQL 드라이버의 쓰기 오류 메시지에는 바인딩 값이 들어간다("Failing row contains (...)"). 공통 오류 처리기가 예외를 원인째
 * 기록하므로 DB 오류는 SQLState만 남긴 새 예외로 바꿔 던진다. 재시도 가능 여부(503/500) 분류는 유지한다.
 */
@Repository
@RequiredArgsConstructor
public class HealthRecordJdbcRepository {

    private final JdbcTemplate jdbc;

    /**
     * 활성 회원의 현재 건강정보 동의를 회원 행 FOR SHARE로 읽는다(D-6). 동의 철회(회원 행 UPDATE)가 먼저 커밋됐으면 철회 값을 읽고, 이 조회가
     * 먼저 잠그면 철회는 이 트랜잭션이 끝날 때까지 기다린다. 이 트랜잭션은 회원 행보다 먼저 잠그는 행이 없다.
     *
     * @return 활성 회원이 아니면 빈 값, 있으면 동의 여부
     */
    public Optional<Boolean> lockActiveUserConsent(long userId) {
        return db(
                () ->
                        jdbc.query(
                                        "SELECT health_data_access = 'AGREEE' AS consented FROM users"
                                                + " WHERE id = ? AND account_status = 'ACTIVE' FOR SHARE",
                                        (rs, n) -> rs.getBoolean("consented"),
                                        userId)
                                .stream()
                                .findFirst());
    }

    /**
     * 날짜별 추정값을 저장된 revision보다 클 때만 넣거나 갱신한다. 비교는 이 문장 안에서 하므로 같은 날짜의 동시 요청도 충돌 행을 잠근 뒤 최신 행으로
     * 다시 판정되어 최종값은 가장 큰 revision이다. 다른 건강 컬럼은 바꾸지 않는다.
     *
     * @return 삽입 또는 갱신했으면 true, 저장된 revision이 같거나 커서 바꾸지 않았으면 false
     */
    public boolean upsertRestingHr(
            long userId, LocalDate metricDate, BigDecimal restingHrBpm, int revision) {
        return !db(
                        () ->
                                jdbc.queryForList(
                                        """
                                        INSERT INTO daily_health_metrics(user_id, metric_date, rhr_bpm, rhr_revision)
                                        VALUES (?, ?, ?, ?)
                                        ON CONFLICT ON CONSTRAINT uq_daily_health_metrics_user_id_metric_date
                                        DO UPDATE SET rhr_bpm = EXCLUDED.rhr_bpm, rhr_revision = EXCLUDED.rhr_revision
                                        WHERE daily_health_metrics.rhr_revision IS NULL
                                           OR daily_health_metrics.rhr_revision < EXCLUDED.rhr_revision
                                        RETURNING id
                                        """,
                                        Long.class,
                                        userId,
                                        metricDate,
                                        restingHrBpm,
                                        revision))
                .isEmpty();
    }

    /**
     * 날짜별 수면 합계(분)를 넣거나, 저장값과 다를 때만 갱신한다(마지막 값 우선, S15P31E105-572). revision이 없으므로 같은 값 재전송은
     * 갱신하지 않아 duplicate가 된다. 다른 건강 컬럼은 바꾸지 않는다.
     *
     * @return 삽입 또는 갱신했으면 true, 저장값과 같아 바꾸지 않았으면 false
     */
    public boolean upsertSleep(long userId, LocalDate metricDate, BigDecimal sleepDurationMin) {
        return !db(
                        () ->
                                jdbc.queryForList(
                                        """
                                        INSERT INTO daily_health_metrics(user_id, metric_date, sleep_duration_min)
                                        VALUES (?, ?, ?)
                                        ON CONFLICT ON CONSTRAINT uq_daily_health_metrics_user_id_metric_date
                                        DO UPDATE SET sleep_duration_min = EXCLUDED.sleep_duration_min
                                        WHERE daily_health_metrics.sleep_duration_min
                                              IS DISTINCT FROM EXCLUDED.sleep_duration_min
                                        RETURNING id
                                        """,
                                        Long.class,
                                        userId,
                                        metricDate,
                                        sleepDurationMin))
                .isEmpty();
    }

    /**
     * DB 오류를 값이 없는 예외로 바꾼다. 원인 예외는 연결하지 않는다(연결하면 원인 메시지가 함께 기록된다). 잠금 대기 초과(55P03) 등은 공통
     * 기준({@link RetryableSqlStates})으로 재시도 가능한 장애(503)로 바꾼다.
     */
    private static <T> T db(Supplier<T> action) {
        try {
            return action.get();
        } catch (DataAccessException e) {
            String sqlState = sqlState(e);
            // 공통 오류 처리기가 이 예외를 한 번 기록한다. 여기서 다시 기록하지 않는다.
            String message =
                    "W06 DB 처리 실패 (SQLState " + sqlState + ", " + e.getClass().getSimpleName() + ")";
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
