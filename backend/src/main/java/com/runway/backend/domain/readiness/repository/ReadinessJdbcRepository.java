package com.runway.backend.domain.readiness.repository;

import com.runway.backend.domain.readiness.formula.DailyHealthInput;
import com.runway.backend.domain.readiness.formula.ReadinessConfidence;
import java.math.BigDecimal;
import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 준비도 평가·조회 저장소. 건강 값은 바인딩 파라미터로만 전달한다.
 *
 * <p>직접 SQL을 쓰는 이유: 같은 회원 평가 직렬화(advisory lock), 동의 확인 행 잠금(FOR SHARE), {@code (user_id,
 * readiness_date)} 유니크 키 upsert(ON CONFLICT)는 JPA 기본 기능으로 표현하기 어렵다. 회원·일별 건강 테이블은 다른 유스케이스 소유이므로
 * 필요한 컬럼만 읽고 쓰지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class ReadinessJdbcRepository {

    /** pg_advisory_xact_lock(int,int)의 첫 번째 키. 다른 기능의 advisory lock과 구분한다. */
    static final int EVALUATION_LOCK_NAMESPACE = 254_001;

    private final JdbcTemplate jdbc;

    /**
     * 같은 회원의 준비도 평가를 트랜잭션 끝까지 한 줄로 세운다. 회원 ID를 int 범위로 접어 키로 쓰므로 드물게 다른 회원끼리 같이 기다릴 수 있으나 결과는
     * 바뀌지 않는다.
     */
    public void lockEvaluation(long userId) {
        jdbc.query(
                "SELECT pg_advisory_xact_lock(?, ?)",
                rs -> {},
                EVALUATION_LOCK_NAMESPACE,
                (int) (userId % Integer.MAX_VALUE));
    }

    /**
     * 활성 회원의 현재 건강정보 동의를 회원 행 FOR SHARE로 읽는다. 평가가 끝날 때까지 동의 철회(회원 행 UPDATE)는 기다리고, 먼저 커밋된 철회는 읽힌다.
     *
     * @return 활성 회원이 아니면 빈 값, 있으면 동의 여부
     */
    public Optional<Boolean> lockActiveUserConsent(long userId) {
        return consent(userId, " FOR SHARE");
    }

    /** 잠그지 않고 활성 회원의 현재 건강정보 동의를 읽는다(R02 조회). */
    public Optional<Boolean> findActiveUserConsent(long userId) {
        return consent(userId, "");
    }

    private Optional<Boolean> consent(long userId, String lock) {
        return jdbc
                .query(
                        "SELECT health_data_access = 'AGREE' AS consented FROM users"
                                + " WHERE id = ? AND account_status = 'ACTIVE'"
                                + lock,
                        (rs, n) -> rs.getBoolean("consented"),
                        userId)
                .stream()
                .findFirst();
    }

    /** from~to(포함) 일별 건강값. 행이 없는 날짜는 결과에 없다. */
    public List<DailyHealthInput> findHealthInputs(long userId, LocalDate from, LocalDate to) {
        return jdbc.query(
                """
                SELECT metric_date, sleep_duration_min, rhr_bpm, daily_training_load
                FROM daily_health_metrics
                WHERE user_id = ? AND metric_date BETWEEN ? AND ?
                ORDER BY metric_date
                """,
                (rs, n) ->
                        new DailyHealthInput(
                                rs.getObject("metric_date", LocalDate.class),
                                rs.getBigDecimal("sleep_duration_min"),
                                rs.getBigDecimal("rhr_bpm"),
                                rs.getBigDecimal("daily_training_load")),
                userId,
                Date.valueOf(from),
                Date.valueOf(to));
    }

    /** from~to(포함)에 건강 행이 있는 날짜. 오름차순. */
    public List<LocalDate> findMetricDates(long userId, LocalDate from, LocalDate to) {
        return jdbc.query(
                """
                SELECT metric_date FROM daily_health_metrics
                WHERE user_id = ? AND metric_date BETWEEN ? AND ?
                ORDER BY metric_date
                """,
                (rs, n) -> rs.getObject("metric_date", LocalDate.class),
                userId,
                Date.valueOf(from),
                Date.valueOf(to));
    }

    /** 같은 회원·날짜 결과가 있으면 점수·신뢰도를 갱신하고 없으면 넣는다. updated_at은 트리거가 갱신한다. */
    public void upsert(
            long userId, LocalDate readinessDate, BigDecimal score, ReadinessConfidence confidence) {
        jdbc.update(
                """
                INSERT INTO daily_readiness(user_id, readiness_date, readiness_score, readiness_confidence)
                VALUES (?, ?, ?, ?::daily_readiness_readiness_confidence_enum)
                ON CONFLICT ON CONSTRAINT uq_daily_readiness_user_id_readiness_date
                DO UPDATE SET readiness_score = EXCLUDED.readiness_score,
                              readiness_confidence = EXCLUDED.readiness_confidence
                """,
                userId,
                Date.valueOf(readinessDate),
                score,
                confidence == null ? null : confidence.name());
    }

    /**
     * 본인의 기준 날짜가 가장 늦은 준비도 1건과 같은 날짜의 본인 일별 건강 지표. 건강 행이 없으면 지표는 null이며 다른 날짜 값으로 대체하지
     * 않는다. {@code (user_id, metric_date)} 유니크 키라 조인으로 행이 늘지 않는다.
     *
     * <p>활성 회원·건강정보 동의 조건을 같은 문장에 넣어, 앞선 동의 확인 뒤 철회가 커밋됐으면 행을 반환하지 않는다.
     */
    public Optional<LatestReadinessRow> findLatest(long userId) {
        return jdbc
                .query(
                        """
                        SELECT r.id, r.readiness_score, r.readiness_date,
                               r.readiness_confidence::text AS confidence,
                               m.rhr_bpm,
                               CASE WHEN m.rhr_bpm IS NULL THEN NULL ELSE m.rhr_source END AS rhr_source,
                               m.sleep_duration_min,
                               m.updated_at AS health_updated_at
                        FROM daily_readiness r
                        JOIN users u
                          ON u.id = r.user_id
                         AND u.account_status = 'ACTIVE'
                         AND u.health_data_access = 'AGREE'
                        LEFT JOIN daily_health_metrics m
                               ON m.user_id = r.user_id AND m.metric_date = r.readiness_date
                        WHERE r.user_id = ?
                        ORDER BY r.readiness_date DESC
                        LIMIT 1
                        """,
                        (rs, n) -> {
                            OffsetDateTime healthUpdatedAt =
                                    rs.getObject("health_updated_at", OffsetDateTime.class);
                            return new LatestReadinessRow(
                                    rs.getLong("id"),
                                    rs.getBigDecimal("readiness_score"),
                                    rs.getObject("readiness_date", LocalDate.class),
                                    rs.getString("confidence"),
                                    rs.getBigDecimal("rhr_bpm"),
                                    rs.getString("rhr_source"),
                                    rs.getBigDecimal("sleep_duration_min"),
                                    healthUpdatedAt == null ? null : healthUpdatedAt.toInstant());
                        },
                        userId)
                .stream()
                .findFirst();
    }

    /** R02 조회 행. confidence는 미산출이면 null. 건강 지표는 기준일 건강 행이나 값이 없으면 null. */
    public record LatestReadinessRow(
            long id,
            BigDecimal readinessScore,
            LocalDate readinessDate,
            String confidence,
            BigDecimal restingHrBpm,
            String restingHrSource,
            BigDecimal sleepDurationMin,
            Instant healthUpdatedAt) {}
}
