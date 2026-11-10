package com.runway.backend.domain.readiness.trainingload;

import com.runway.backend.domain.readiness.trainingload.TrainingLoadCalculator.Result;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadCalculator.Sample;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.Period;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 운동 부하 저장소(S15P31E105-599). 같은 회원의 부하 쓰기는 {@link #lockUserLoads(long)}로 한 줄로 세운 뒤 조회 → 저장한다. 건강 값은 바인딩
 * 파라미터로만 전달한다.
 *
 * <p>잠금 순서: 회원 행 FOR SHARE → 부하 advisory lock → 일별 건강 행. W06과 러닝 종료 후 부하 저장이 같은 순서를 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class TrainingLoadJdbcRepository {

    /** pg_advisory_xact_lock(int,int)의 첫 번째 키. 준비도 평가(254_001)와 구분한다. */
    static final int LOAD_LOCK_NAMESPACE = 599_001;

    public static final String SOURCE_RUNWAY_SESSION = "RUNWAY_SESSION";
    public static final String SOURCE_SAMSUNG_HEALTH = "SAMSUNG_HEALTH";

    private final JdbcTemplate jdbc;

    /** 활성 회원의 건강정보 동의를 회원 행 FOR SHARE로 읽는다. 활성 회원이 아니면 빈 값. */
    public Optional<Boolean> lockActiveUserConsent(long userId) {
        return jdbc
                .query(
                        "SELECT health_data_access = 'AGREE' AS consented FROM users"
                                + " WHERE id = ? AND account_status = 'ACTIVE' FOR SHARE",
                        (rs, n) -> rs.getBoolean("consented"),
                        userId)
                .stream()
                .findFirst();
    }

    /** 같은 회원의 부하 저장·일별 합 재계산을 트랜잭션 끝까지 한 줄로 세운다. */
    public void lockUserLoads(long userId) {
        jdbc.query(
                "SELECT pg_advisory_xact_lock(?, ?)",
                rs -> {},
                LOAD_LOCK_NAMESPACE,
                (int) (userId % Integer.MAX_VALUE));
    }

    /** 러닝의 회원·시각·삭제 여부. 시작·종료 시각이 없으면(종료 전) 해당 시각은 null이다. */
    public Optional<SessionInfo> findSession(long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT user_id, started_at, ended_at, deleted_at IS NOT NULL AS deleted
                        FROM running_sessions WHERE id = ?
                        """,
                        (rs, n) ->
                                new SessionInfo(
                                        sessionId,
                                        rs.getLong("user_id"),
                                        instant(rs.getObject("started_at", OffsetDateTime.class)),
                                        instant(rs.getObject("ended_at", OffsetDateTime.class)),
                                        rs.getBoolean("deleted")),
                        sessionId)
                .stream()
                .findFirst();
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    /** 측정된 심박 샘플. 측정 시각 오름차순, 같은 시각은 저장 순서(id). */
    public List<Sample> findSessionHeartRates(long sessionId) {
        return jdbc.query(
                """
                SELECT measured_at, heart_rate FROM running_metric_samples
                WHERE running_session_id = ? AND is_hr_measured AND heart_rate IS NOT NULL
                ORDER BY measured_at, id
                """,
                (rs, n) ->
                        new Sample(
                                rs.getObject("measured_at", OffsetDateTime.class).toInstant(),
                                rs.getBigDecimal("heart_rate").doubleValue()),
                sessionId);
    }

    /**
     * 운동 날짜 기준 Zone 계산값. HRmax는 그 날짜 이전(포함) 최근 max_heart_rate → 최신 값 → 220 − 만 나이(H06 통계와 같은 순서). RHR은 그 날짜
     * 이전(포함) 최근 rhr_bpm → 최신 값 → 0(HRmax 비율). 생년월일이 미래라 나이가 음수이면 HRmax를 정하지 못한다.
     */
    public Optional<ZoneParams> findZoneParams(long userId, LocalDate date) {
        Optional<BigDecimal> hrMax =
                metricOnOrBefore(userId, date, "max_heart_rate")
                        .or(() -> latestMetric(userId, "max_heart_rate"));
        Optional<Double> hrMaxValue =
                hrMax.map(BigDecimal::doubleValue)
                        .or(
                                () ->
                                        birthDate(userId)
                                                .map(b -> Period.between(b, date).getYears())
                                                .filter(age -> age >= 0)
                                                .map(age -> 220.0 - age));
        if (hrMaxValue.isEmpty()) {
            return Optional.empty();
        }
        double rhr =
                metricOnOrBefore(userId, date, "rhr_bpm")
                        .or(() -> latestMetric(userId, "rhr_bpm"))
                        .map(BigDecimal::doubleValue)
                        .orElse(0.0);
        return Optional.of(new ZoneParams(hrMaxValue.get(), rhr));
    }

    private Optional<BigDecimal> metricOnOrBefore(long userId, LocalDate date, String column) {
        return jdbc
                .query(
                        "SELECT "
                                + column
                                + " AS v FROM daily_health_metrics WHERE user_id = ? AND metric_date <= ? AND "
                                + column
                                + " IS NOT NULL ORDER BY metric_date DESC LIMIT 1",
                        (rs, n) -> rs.getBigDecimal("v"),
                        userId,
                        Date.valueOf(date))
                .stream()
                .findFirst();
    }

    private Optional<BigDecimal> latestMetric(long userId, String column) {
        return jdbc
                .query(
                        "SELECT "
                                + column
                                + " AS v FROM daily_health_metrics WHERE user_id = ? AND "
                                + column
                                + " IS NOT NULL ORDER BY metric_date DESC LIMIT 1",
                        (rs, n) -> rs.getBigDecimal("v"),
                        userId)
                .stream()
                .findFirst();
    }

    private Optional<LocalDate> birthDate(long userId) {
        return jdbc
                .query(
                        "SELECT birth_date FROM users WHERE id = ?",
                        (rs, n) -> rs.getObject("birth_date", LocalDate.class),
                        userId)
                .stream()
                .findFirst();
    }

    public Optional<StoredLoad> findBySession(long sessionId) {
        return find("running_session_id = ?", sessionId);
    }

    public Optional<StoredLoad> findByExternalId(long userId, String externalId) {
        return find(
                "user_id = ? AND source = '" + SOURCE_SAMSUNG_HEALTH + "' AND external_id = ?",
                userId,
                externalId);
    }

    private Optional<StoredLoad> find(String where, Object... args) {
        return jdbc
                .query(
                        "SELECT id, started_at, ended_at, metric_date, zone1_seconds, zone2_seconds,"
                                + " zone3_seconds, zone4_seconds, zone5_seconds, training_load"
                                + " FROM exercise_training_loads WHERE "
                                + where,
                        (rs, n) ->
                                new StoredLoad(
                                        rs.getLong("id"),
                                        rs.getObject("started_at", OffsetDateTime.class).toInstant(),
                                        rs.getObject("ended_at", OffsetDateTime.class).toInstant(),
                                        rs.getObject("metric_date", LocalDate.class),
                                        new Result(
                                                List.of(
                                                        rs.getInt("zone1_seconds"),
                                                        rs.getInt("zone2_seconds"),
                                                        rs.getInt("zone3_seconds"),
                                                        rs.getInt("zone4_seconds"),
                                                        rs.getInt("zone5_seconds")),
                                                rs.getBigDecimal("training_load"))),
                        args)
                .stream()
                .findFirst();
    }

    public void insert(
            long userId,
            String source,
            Long sessionId,
            String externalId,
            Instant startedAt,
            Instant endedAt,
            LocalDate metricDate,
            Result result) {
        jdbc.update(
                """
                INSERT INTO exercise_training_loads(user_id, source, running_session_id, external_id,
                    started_at, ended_at, metric_date, zone1_seconds, zone2_seconds, zone3_seconds,
                    zone4_seconds, zone5_seconds, training_load)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                userId,
                source,
                sessionId,
                externalId,
                Timestamp.from(startedAt),
                Timestamp.from(endedAt),
                Date.valueOf(metricDate),
                result.zoneSeconds(1),
                result.zoneSeconds(2),
                result.zoneSeconds(3),
                result.zoneSeconds(4),
                result.zoneSeconds(5),
                result.trainingLoad());
    }

    public void update(
            long id, Instant startedAt, Instant endedAt, LocalDate metricDate, Result result) {
        jdbc.update(
                """
                UPDATE exercise_training_loads
                SET started_at = ?, ended_at = ?, metric_date = ?, zone1_seconds = ?, zone2_seconds = ?,
                    zone3_seconds = ?, zone4_seconds = ?, zone5_seconds = ?, training_load = ?
                WHERE id = ?
                """,
                Timestamp.from(startedAt),
                Timestamp.from(endedAt),
                Date.valueOf(metricDate),
                result.zoneSeconds(1),
                result.zoneSeconds(2),
                result.zoneSeconds(3),
                result.zoneSeconds(4),
                result.zoneSeconds(5),
                result.trainingLoad(),
                id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM exercise_training_loads WHERE id = ?", id);
    }

    /** 시간 [startedAt, endedAt)과 겹치는 회원의 삼성 헬스 운동 날짜. */
    public List<LocalDate> findOverlappingSamsungDates(
            long userId, Instant startedAt, Instant endedAt) {
        return jdbc.query(
                """
                SELECT DISTINCT metric_date FROM exercise_training_loads
                WHERE user_id = ? AND source = 'SAMSUNG_HEALTH'
                  AND started_at < ? AND ended_at > ?
                ORDER BY metric_date
                """,
                (rs, n) -> rs.getObject("metric_date", LocalDate.class),
                userId,
                Timestamp.from(endedAt),
                Timestamp.from(startedAt));
    }

    /**
     * 날짜의 일별 부하를 다시 계산해 {@code daily_health_metrics.daily_training_load}에 넣는다. 합 = 그 날짜 RunWay 러닝 부하 + 그 날짜 삼성
     * 헬스 운동 중 같은 회원의 어떤 RunWay 러닝과도 시간이 겹치지 않는 부하. 해당 운동이 없으면 NULL이다. 일별 행이 없고 합도 NULL이면 행을 만들지 않는다.
     * 다른 건강 컬럼은 바꾸지 않는다.
     *
     * @return 저장값이 바뀌었으면 true
     */
    public boolean recomputeDaily(long userId, LocalDate date) {
        BigDecimal total =
                jdbc.queryForObject(
                        """
                        SELECT SUM(e.training_load) FROM exercise_training_loads e
                        WHERE e.user_id = ? AND e.metric_date = ?
                          AND (e.source = 'RUNWAY_SESSION'
                               OR NOT EXISTS (
                                   SELECT 1 FROM exercise_training_loads r
                                   WHERE r.user_id = e.user_id AND r.source = 'RUNWAY_SESSION'
                                     AND r.started_at < e.ended_at AND r.ended_at > e.started_at))
                        """,
                        BigDecimal.class,
                        userId,
                        Date.valueOf(date));
        if (total == null) {
            return jdbc.update(
                            """
                            UPDATE daily_health_metrics SET daily_training_load = NULL
                            WHERE user_id = ? AND metric_date = ? AND daily_training_load IS NOT NULL
                            """,
                            userId,
                            Date.valueOf(date))
                    > 0;
        }
        return jdbc.update(
                        """
                        INSERT INTO daily_health_metrics(user_id, metric_date, daily_training_load)
                        VALUES (?, ?, ?)
                        ON CONFLICT ON CONSTRAINT uq_daily_health_metrics_user_id_metric_date
                        DO UPDATE SET daily_training_load = EXCLUDED.daily_training_load
                        WHERE daily_health_metrics.daily_training_load
                              IS DISTINCT FROM EXCLUDED.daily_training_load
                        """,
                        userId,
                        Date.valueOf(date),
                        total)
                > 0;
    }

    public record SessionInfo(
            long sessionId, long userId, Instant startedAt, Instant endedAt, boolean deleted) {

        /** 부하를 둘 수 있는 러닝: 삭제되지 않았고 시작·종료 시각이 있다. */
        public boolean countable() {
            return !deleted && startedAt != null && endedAt != null && !endedAt.isBefore(startedAt);
        }
    }

    public record ZoneParams(double hrMax, double rhr) {}

    public record StoredLoad(
            long id, Instant startedAt, Instant endedAt, LocalDate metricDate, Result result) {

        /** 시각·날짜·Zone 초·부하가 모두 같은가(부하는 값 비교). */
        public boolean sameAs(Instant start, Instant end, LocalDate date, Result other) {
            return startedAt.equals(start)
                    && endedAt.equals(end)
                    && metricDate.equals(date)
                    && result.zoneSeconds().equals(other.zoneSeconds())
                    && result.trainingLoad().compareTo(other.trainingLoad()) == 0;
        }
    }
}
