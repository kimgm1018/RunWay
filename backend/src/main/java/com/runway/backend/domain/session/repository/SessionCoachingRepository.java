package com.runway.backend.domain.session.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
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

    /** 새 추천을 저장하고 ID를 돌려준다. 기준 버전과 만료시각을 함께 채운다(ck_coaching_context). */
    public long insertDecision(
            long sessionId,
            int elapsedDurationSec,
            BigDecimal recommendedPace,
            int cueBpm,
            long basedOnStateVersion,
            Instant createdAt,
            Instant expiresAt) {
        Long id =
                jdbc.queryForObject(
                        """
                        INSERT INTO coaching_decisions(session_id,elapsed_duration,recommended_pace,cue_bpm,
                                                       based_on_state_version,expires_at,created_at)
                        VALUES (?,?,?,?,?,?,?) RETURNING id
                        """,
                        Long.class,
                        sessionId,
                        elapsedDurationSec,
                        recommendedPace,
                        cueBpm,
                        basedOnStateVersion,
                        Timestamp.from(expiresAt),
                        Timestamp.from(createdAt));
        if (id == null) {
            throw new IllegalStateException("coaching decision id not returned");
        }
        return id;
    }
}
