package com.runway.backend.domain.survey.repository;

import com.runway.backend.domain.survey.dto.response.SatisfactionSurveyResponse;
import java.sql.Timestamp;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 만족도 조사 응답 저장소(S15P31E105-813, V41). 저장 시각을 DB 기본값으로 받아 그대로 응답하려고 INSERT ... RETURNING을 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class SatisfactionSurveyRepository {

    /** 집계 SQL 정본. docs/design/api/satisfaction-surveys.md의 "응답 집계"와 같은 쿼리다. 구간은 [from, to). */
    static final String SUMMARY_SQL =
            """
            SELECT count(*) AS response_count, round(avg(score), 2) AS average_score
            FROM satisfaction_survey_responses
            WHERE created_at >= ? AND created_at < ?
            """;

    /**
     * 응답자 기준 집계 SQL 정본. 문서 "응답자 기준"과 같은 쿼리다. 기간 안에서 회원별 평균을 먼저 구해 회원마다 한 번씩만 반영한다.
     */
    static final String RESPONDENT_SUMMARY_SQL =
            """
            SELECT count(*) AS respondent_count, round(avg(member_score), 2) AS average_score
            FROM (
                SELECT user_id, avg(score) AS member_score
                FROM satisfaction_survey_responses
                WHERE created_at >= ? AND created_at < ?
                GROUP BY user_id
            ) members
            """;

    private final JdbcTemplate jdbc;

    /** 응답 한 건을 저장한다. 탈퇴(진행) 회원이면 rw_active_owner 트리거가 거절한다. */
    public SatisfactionSurveyResponse insert(
            long userId, int score, String comment, String source) {
        return jdbc.queryForObject(
                """
                INSERT INTO satisfaction_survey_responses(user_id, score, comment, source)
                VALUES (?, ?, ?, ?)
                RETURNING id, score, comment, source, created_at
                """,
                (rs, n) ->
                        new SatisfactionSurveyResponse(
                                rs.getLong("id"),
                                rs.getInt("score"),
                                rs.getString("comment"),
                                rs.getString("source"),
                                rs.getTimestamp("created_at").toInstant()),
                userId,
                score,
                comment,
                source);
    }

    /** 제출 시각이 [from, to)인 응답의 수와 평균 점수. */
    public SatisfactionSurveySummary summarize(Instant from, Instant to) {
        return jdbc.queryForObject(
                SUMMARY_SQL,
                (rs, n) ->
                        new SatisfactionSurveySummary(
                                rs.getLong("response_count"), rs.getBigDecimal("average_score")),
                Timestamp.from(from),
                Timestamp.from(to));
    }

    /** 제출 시각이 [from, to)인 응답을 회원 단위로 묶은 응답자 수와 회원별 평균의 평균. */
    public SatisfactionSurveySummary summarizeByRespondent(Instant from, Instant to) {
        return jdbc.queryForObject(
                RESPONDENT_SUMMARY_SQL,
                (rs, n) ->
                        new SatisfactionSurveySummary(
                                rs.getLong("respondent_count"), rs.getBigDecimal("average_score")),
                Timestamp.from(from),
                Timestamp.from(to));
    }
}
