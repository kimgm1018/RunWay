package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.coaching.decide.CoachingLevel;
import com.runway.backend.domain.coaching.decide.CoachingSource;
import com.runway.backend.domain.coaching.decide.GuidePaceSetAt;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 서버 코칭 발행에 필요한 조회·저장. coaching_decisions는 기존 V1/V3 테이블이며 JPA Entity 없이 필요한 컬럼만 SQL로 다룬다. 호출하는 서비스의
 * 트랜잭션 커넥션을 사용한다.
 */
@Repository
public class SessionCoachingRepository {

    private final JdbcTemplate jdbc;

    public SessionCoachingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 건강정보 동의 여부. 세션 잠금 뒤 다시 읽어 그 사이 커밋된 철회를 반영한다. */
    public boolean healthConsented(long userId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM users WHERE id = ? AND health_data_access = 'AGREEE')",
                        Boolean.class,
                        userId));
    }

    /** 2분 기준시각 후보. 서버에 APPLIED로 확인된 마지막 재개·코칭 적용시각이다. */
    public Optional<Instant> lastAppliedResumeOrCoaching(long sessionId) {
        Timestamp value =
                jdbc.queryForObject(
                        """
                        SELECT max(applied_at) FROM session_control_events
                        WHERE session_id = ? AND result = 'APPLIED' AND action IN ('RESUME','COACHING')
                        """,
                        Timestamp.class,
                        sessionId);
        return Optional.ofNullable(value).map(Timestamp::toInstant);
    }

    /** 가장 최근 COACHING 명령의 결과와 발행 시각. 적용되지 않은 코칭의 재발행 간격 판단에 쓴다. */
    public Optional<LastCoaching> lastCoaching(long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT result::text AS result, created_at FROM session_control_events
                        WHERE session_id = ? AND action = 'COACHING'
                        ORDER BY id DESC LIMIT 1
                        """,
                        (rs, n) ->
                                new LastCoaching(
                                        rs.getString("result"),
                                        rs.getTimestamp("created_at").toInstant()),
                        sessionId)
                .stream()
                .findFirst();
    }

    public record LastCoaching(String result, Instant issuedAt) {
        public boolean applied() {
            return "APPLIED".equals(result);
        }
    }

    /**
     * AI04 history용 최근 측정 표본(경과초 오름차순). 최신 경과초에서 {@code windowSec} 이내만 읽는다. 심박은 실제 측정
     * (is_hr_measured)일 때만 돌려준다.
     */
    public List<CoachingSource.Sample> recentSamples(long sessionId, int windowSec) {
        return recentSamples(sessionId, windowSec, true);
    }

    public List<CoachingSource.Sample> recentSamples(
            long sessionId, int windowSec, boolean includeHeartRate) {
        return jdbc.query(
                """
                SELECT elapsed_duration, measured_at,
                       CASE WHEN ? AND is_hr_measured THEN heart_rate END AS heart_rate,
                       speed, grade, total_distance, route_progress
                FROM running_metric_samples
                WHERE running_session_id = ?
                  AND elapsed_duration > (SELECT max(elapsed_duration) FROM running_metric_samples
                                          WHERE running_session_id = ?) - ?
                ORDER BY elapsed_duration, measured_at, id
                """,
                (rs, n) ->
                        new CoachingSource.Sample(
                                rs.getInt("elapsed_duration"),
                                rs.getTimestamp("measured_at").toInstant(),
                                doubleOrNull(rs.getBigDecimal("heart_rate")),
                                doubleOrNull(rs.getBigDecimal("speed")),
                                doubleOrNull(rs.getBigDecimal("grade")),
                                doubleOrNull(rs.getBigDecimal("total_distance")),
                                doubleOrNull(rs.getBigDecimal("route_progress"))),
                includeHeartRate,
                sessionId,
                sessionId,
                windowSec);
    }

    /** 워치에 적용(APPLIED)된 마지막 코칭과 그 추천 페이스·단계. */
    public Optional<CoachingSource.AppliedCoaching> lastAppliedCoaching(long sessionId) {
        return jdbc
                .query(
                        """
                        SELECT e.coaching_id, e.applied_at, d.recommended_pace, d.coaching_level
                        FROM session_control_events e
                        JOIN coaching_decisions d ON d.id = e.coaching_id
                        WHERE e.session_id = ? AND e.action = 'COACHING' AND e.result = 'APPLIED'
                        ORDER BY e.applied_at DESC, e.id DESC LIMIT 1
                        """,
                        (rs, n) ->
                                new CoachingSource.AppliedCoaching(
                                        rs.getLong("coaching_id"),
                                        rs.getTimestamp("applied_at").toInstant(),
                                        rs.getBigDecimal("recommended_pace"),
                                        coachingLevel(rs.getString("coaching_level"))),
                        sessionId)
                .stream()
                .findFirst();
    }

    /**
     * 현재 안내 페이스가 처음 적용된 시각({@code guidePaceSetAt}). 같은 추천 페이스의 연속 APPLIED는 streak 시작 시각으로
     * 본다(S15P31E105-516).
     */
    public Optional<Instant> guidePaceSetAt(long sessionId) {
        List<GuidePaceSetAt.AppliedPace> applied =
                jdbc.query(
                        """
                        SELECT e.applied_at, d.recommended_pace
                        FROM session_control_events e
                        JOIN coaching_decisions d ON d.id = e.coaching_id
                        WHERE e.session_id = ? AND e.action = 'COACHING' AND e.result = 'APPLIED'
                        ORDER BY e.applied_at DESC, e.id DESC
                        """,
                        (rs, n) ->
                                new GuidePaceSetAt.AppliedPace(
                                        rs.getTimestamp("applied_at").toInstant(),
                                        rs.getBigDecimal("recommended_pace")),
                        sessionId);
        return Optional.ofNullable(GuidePaceSetAt.resolve(applied));
    }

    private static CoachingLevel coachingLevel(String value) {
        if (value == null) {
            return null;
        }
        return CoachingLevel.valueOf(value);
    }

    /**
     * 러닝을 시작한 뒤 사용자가 직접 바꾼 BPM(SET_BPM)이 워치에 적용된 적이 있는지. 출발 전에 고른 BPM은 시작 BPM일 뿐이므로 세지 않는다(후속
     * 리뷰 F-2, 2026-11-05 사용자 확정).
     */
    public boolean hasAppliedManualBpm(long sessionId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        """
                        SELECT EXISTS (SELECT 1 FROM session_control_events e
                                       JOIN running_sessions s ON s.id = e.session_id
                                       WHERE e.session_id = ? AND e.action = 'SET_BPM' AND e.result = 'APPLIED'
                                         AND s.started_at IS NOT NULL AND e.applied_at >= s.started_at)
                        """,
                        Boolean.class,
                        sessionId));
    }

    /** 마지막으로 적용된 재개 시각. */
    public Optional<Instant> lastAppliedResume(long sessionId) {
        Timestamp value =
                jdbc.queryForObject(
                        """
                        SELECT max(applied_at) FROM session_control_events
                        WHERE session_id = ? AND result = 'APPLIED' AND action = 'RESUME'
                        """,
                        Timestamp.class,
                        sessionId);
        return Optional.ofNullable(value).map(Timestamp::toInstant);
    }

    /** 코스 거리와 100m 경사 목록 JSON(courses.md elevationProfile). 경사가 없으면 profileJson은 null. */
    public Optional<CourseGrade> courseGrade(long courseId) {
        return jdbc
                .query(
                        "SELECT distance, elevation_profile::text AS profile FROM courses WHERE id = ?",
                        (rs, n) ->
                                new CourseGrade(rs.getBigDecimal("distance"), rs.getString("profile")),
                        courseId)
                .stream()
                .findFirst();
    }

    public record CourseGrade(BigDecimal distanceM, String profileJson) {}

    private static Double doubleOrNull(BigDecimal value) {
        return value == null ? null : value.doubleValue();
    }

    /**
     * AI04 추천을 예측 심박·코스 진행거리와 함께 저장하고 ID를 돌려준다. 기준 버전과 만료시각을 함께 채운다(ck_coaching_context).
     */
    public long insertDecision(
            long sessionId,
            int elapsedDurationSec,
            BigDecimal recommendedPace,
            int cueBpm,
            BigDecimal predictedHr30,
            BigDecimal predictedHr60,
            BigDecimal predictedHr120,
            BigDecimal routeProgress,
            long basedOnStateVersion,
            Instant createdAt,
            Instant expiresAt,
            CoachingLevel coachingLevel) {
        Long id =
                jdbc.queryForObject(
                        """
                        INSERT INTO coaching_decisions(session_id,elapsed_duration,recommended_pace,cue_bpm,
                                                       predicted_hr_30_bpm,predicted_hr_60_bpm,predicted_hr_120_bpm,
                                                       route_progress,based_on_state_version,expires_at,created_at,
                                                       coaching_level)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id
                        """,
                        Long.class,
                        sessionId,
                        elapsedDurationSec,
                        recommendedPace,
                        cueBpm,
                        predictedHr30,
                        predictedHr60,
                        predictedHr120,
                        routeProgress,
                        basedOnStateVersion,
                        Timestamp.from(expiresAt),
                        Timestamp.from(createdAt),
                        coachingLevel == null ? null : coachingLevel.name());
        if (id == null) {
            throw new IllegalStateException("coaching decision id not returned");
        }
        return id;
    }
}
