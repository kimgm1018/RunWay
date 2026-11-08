package com.runway.backend.domain.grouprun.repository;

import com.runway.backend.domain.grouprun.helper.GroupRunFitCalculator;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 그룹런 적합도 근거 조회(읽기 전용). 러닝 세션·일별 준비도 테이블에서 필요한 컬럼만 읽으며 쓰지 않는다. 직접 SQL을 쓰는 이유: 사용자별 최근 N건(윈도 함수)과 사용자별 최신 1건(DISTINCT
 * ON)을 한 번에 가져와 참가자 수만큼 반복 조회하지 않기 위해서다.
 */
@Repository
public class GroupRunFitJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public GroupRunFitJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 사용자별 최근 완료(COMPLETED)·미삭제 세션의 평균 페이스를 최신순으로 최대 {@value GroupRunFitCalculator#RECENT_SESSION_LIMIT}개씩 돌려준다.
     * 평균 페이스가 없는 세션은 제외한다. 세션이 없는 사용자는 키가 없다.
     */
    public Map<Long, List<BigDecimal>> findRecentCompletedPaces(Collection<Long> userIds) {
        Map<Long, List<BigDecimal>> result = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return result;
        }
        List<Object> args = new ArrayList<>(userIds);
        args.add(GroupRunFitCalculator.RECENT_SESSION_LIMIT);
        jdbcTemplate.query(
                """
                SELECT user_id, average_pace
                FROM (
                    SELECT s.user_id,
                           s.average_pace,
                           ROW_NUMBER() OVER (
                               PARTITION BY s.user_id
                               ORDER BY COALESCE(s.ended_at, s.started_at) DESC NULLS LAST, s.id DESC
                           ) AS rn
                    FROM running_sessions s
                    WHERE s.user_id IN (%s)
                      AND s.status = 'COMPLETED'::running_sessions_status_enum
                      AND s.deleted_at IS NULL
                      AND s.average_pace IS NOT NULL
                      AND s.average_pace > 0
                ) t
                WHERE rn <= ?
                ORDER BY user_id, rn
                """
                        .formatted(placeholders(userIds.size())),
                rs -> {
                    result.computeIfAbsent(rs.getLong("user_id"), k -> new ArrayList<>())
                            .add(rs.getBigDecimal("average_pace"));
                },
                args.toArray());
        return result;
    }

    /**
     * 사용자별 최신 준비도 점수(R02와 같은 기준: 기준일이 가장 늦은 1건, 날짜 필터 없음). R02와 같이 활성 회원이고 건강정보 동의가 있어야 하며, 아니면 키가 없다.
     */
    public Map<Long, BigDecimal> findLatestReadinessScores(Collection<Long> userIds) {
        Map<Long, BigDecimal> result = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return result;
        }
        jdbcTemplate.query(
                """
                SELECT DISTINCT ON (dr.user_id) dr.user_id, dr.readiness_score
                FROM daily_readiness dr
                INNER JOIN users u ON u.id = dr.user_id
                WHERE dr.user_id IN (%s)
                  AND u.account_status = 'ACTIVE'
                  AND u.health_data_access = 'AGREEE'
                ORDER BY dr.user_id, dr.readiness_date DESC, dr.id DESC
                """
                        .formatted(placeholders(userIds.size())),
                rs -> {
                    result.put(rs.getLong("user_id"), rs.getBigDecimal("readiness_score"));
                },
                userIds.toArray());
        return result;
    }

    private static String placeholders(int count) {
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }
}
