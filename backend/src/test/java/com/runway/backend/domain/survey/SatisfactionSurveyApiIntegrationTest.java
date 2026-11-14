package com.runway.backend.domain.survey;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.survey.repository.SatisfactionSurveyRepository;
import com.runway.backend.domain.survey.repository.SatisfactionSurveySummary;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** S15P31E105-813 AC-1~AC-5: SV01 제출·입력 검증·인증·탈퇴 회원 거절과 기간 집계. */
class SatisfactionSurveyApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private SatisfactionSurveyRepository repository;

    private long userId;

    @BeforeEach
    void seed() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('survey_user','hash','설문러너','2000-01-01','MALE','01076340001','AGREE')
                        RETURNING id
                        """,
                        Long.class);
    }

    @Test
    void 점수와_의견을_제출하면_앞뒤공백을_지워_저장하고_201() throws Exception {
        submit("{\"score\":4,\"comment\":\"  좋아요 \",\"source\":\"RUN_RESULT\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.surveyId").isNumber())
                .andExpect(jsonPath("$.score").value(4))
                .andExpect(jsonPath("$.comment").value("좋아요"))
                .andExpect(jsonPath("$.source").value("RUN_RESULT"))
                .andExpect(jsonPath("$.submittedAt").isString());

        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT user_id, score, comment, source, created_at FROM"
                                + " satisfaction_survey_responses");
        assertThat(((Number) row.get("user_id")).longValue()).isEqualTo(userId);
        assertThat(((Number) row.get("score")).intValue()).isEqualTo(4);
        assertThat(row.get("comment")).isEqualTo("좋아요");
        assertThat(row.get("source")).isEqualTo("RUN_RESULT");
        assertThat(row.get("created_at")).isNotNull();
    }

    @Test
    void 의견없이_또는_공백의견으로_제출하면_comment는_null() throws Exception {
        submit("{\"score\":5,\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").doesNotExist());
        submit("{\"score\":1,\"comment\":\"   \",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated());

        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM satisfaction_survey_responses WHERE"
                                        + " comment IS NULL AND source='SETTINGS'",
                                Integer.class))
                .isEqualTo(2);
    }

    @Test
    void 같은회원이_여러번_제출할수있다() throws Exception {
        submit("{\"score\":3,\"source\":\"SETTINGS\"}").andExpect(status().isCreated());
        submit("{\"score\":3,\"source\":\"SETTINGS\"}").andExpect(status().isCreated());
        assertThat(count()).isEqualTo(2);
    }

    @Test
    void 의견은_공백제거후_1000자까지() throws Exception {
        String max = "가".repeat(1000);
        submit("{\"score\":2,\"comment\":\" " + max + " \",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").value(max));
        submit("{\"score\":2,\"comment\":\"" + max + "가\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("comment"))
                .andExpect(
                        jsonPath("$.details.fields[0].reason")
                                .value("1000자 이하로, 쓸 수 없는 문자 없이 입력해 주세요."));
        assertThat(count()).isEqualTo(1);
    }

    static Stream<Arguments> invalidBodies() {
        return Stream.of(
                Arguments.of("{\"score\":0,\"source\":\"SETTINGS\"}", "score"),
                Arguments.of("{\"score\":6,\"source\":\"SETTINGS\"}", "score"),
                Arguments.of("{\"source\":\"SETTINGS\"}", "score"),
                Arguments.of("{\"score\":3}", "source"),
                Arguments.of("{\"score\":3,\"source\":\"HOME\"}", "source"),
                Arguments.of("{\"score\":3,\"source\":\"settings\"}", "source"));
    }

    @ParameterizedTest
    @MethodSource("invalidBodies")
    void 범위밖_누락_허용외_값은_400_VALIDATION_ERROR와_필드명(String body, String field)
            throws Exception {
        submit(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value(field));
        assertThat(count()).isZero();
    }

    static Stream<String> unreadableBodies() {
        return Stream.of(
                "{\"score\":\"a\",\"source\":\"SETTINGS\"}",
                "{\"score\":\"5\",\"source\":\"SETTINGS\"}",
                "{\"score\":4.5,\"source\":\"SETTINGS\"}",
                "{\"score\":5.0,\"source\":\"SETTINGS\"}",
                "{\"score\":true,\"source\":\"SETTINGS\"}",
                "{\"score\":4294967300,\"source\":\"SETTINGS\"}",
                "{\"score\":4,\"comment\":123,\"source\":\"SETTINGS\"}",
                "{\"score\":4,\"comment\":[\"a\"],\"source\":\"SETTINGS\"}",
                "{\"score\":");
    }

    /** 정수가 아닌 점수(소수·숫자 문자열 포함)는 잘라 저장하지 않고 거절한다(리뷰 A-1·B-1). */
    @ParameterizedTest
    @MethodSource("unreadableBodies")
    void 정수가_아닌_점수와_문자열이_아닌_의견과_깨진_JSON은_400(String body) throws Exception {
        submit(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(count()).isZero();
    }

    static Stream<String> rejectedComments() {
        return Stream.of(
                "a\\ud800b", // 짝이 맞지 않는 서로게이트(리뷰 B-2)
                "a\\u0000b", // NUL
                "a\\u0007b", // 그 밖의 제어 문자
                "a\\u000bb", // VT
                "a\\u007fb", // DEL
                "\\u0085", // C1 제어 문자(NEL, 재검토 R-1)
                "😀".repeat(1001)); // 코드 포인트 1001자
    }

    @ParameterizedTest
    @MethodSource("rejectedComments")
    void 제어문자_서로게이트_1001자_의견은_400과_comment필드(String comment) throws Exception {
        submit("{\"score\":3,\"comment\":\"" + comment + "\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("comment"));
        assertThat(count()).isZero();
    }

    @Test
    void 의견_글자수는_코드포인트로_세고_줄바꿈은_허용한다() throws Exception {
        String emoji = "😀".repeat(1000);
        submit("{\"score\":3,\"comment\":\"" + emoji + "\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").value(emoji));
        submit("{\"score\":3,\"comment\":\"첫 줄\\n둘째 줄\\t끝\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").value("첫 줄\n둘째 줄\t끝"));
        assertThat(count()).isEqualTo(2);
    }

    @Test
    void 끝의_줄바꿈과_탭은_지우고_명시적_null은_생략과_같다() throws Exception {
        submit("{\"score\":3,\"comment\":\"\\n\\t좋아요\\r\\n\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").value("좋아요"));
        submit("{\"score\":3,\"comment\":null,\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").doesNotExist());
        submit("{\"score\":null,\"source\":\"SETTINGS\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details.fields[0].name").value("score"));
        assertThat(count()).isEqualTo(2);
    }

    @Test
    void NBSP와_폭없는공백만_있는_의견은_null() throws Exception {
        submit("{\"score\":3,\"comment\":\"\\u00a0\\u200b\\ufeff \\u3000\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").doesNotExist());
        submit("{\"score\":3,\"comment\":\"\\u00a0좋아요\\u200b\",\"source\":\"SETTINGS\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.comment").value("좋아요"));
    }

    @Test
    void 본문의_userId는_무시하고_토큰_사용자로_저장한다() throws Exception {
        submit("{\"score\":3,\"source\":\"SETTINGS\",\"userId\":999999}")
                .andExpect(status().isCreated());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT user_id FROM satisfaction_survey_responses", Long.class))
                .isEqualTo(userId);
    }

    @Test
    void 토큰이_없으면_401() throws Exception {
        mockMvc.perform(
                        post("/api/v1/satisfaction-surveys")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"score\":3,\"source\":\"SETTINGS\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(count()).isZero();
    }

    @Test
    void 탈퇴한_회원의_남은_토큰으로는_저장하지_않고_401() throws Exception {
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                userId);
        submit("{\"score\":3,\"source\":\"SETTINGS\"}")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(count()).isZero();
    }

    @Test
    void 기간집계는_반열린구간의_응답수와_평균점수() {
        Instant from = Instant.parse("2026-11-01T00:00:00Z");
        Instant to = Instant.parse("2026-12-01T00:00:00Z");
        insertAt(3, from);
        insertAt(4, Instant.parse("2026-11-15T12:00:00Z"));
        insertAt(5, Instant.parse("2026-11-30T23:59:59Z"));
        insertAt(1, to);
        insertAt(1, Instant.parse("2026-10-31T23:59:59Z"));
        // 삽입 경로와 독립된 기준: UTC 리터럴로 넣은 경계 직전·직후 행(리뷰 B-7).
        jdbc.update(
                "INSERT INTO satisfaction_survey_responses(user_id, score, source, created_at)"
                        + " VALUES (?, 1, 'SETTINGS', TIMESTAMPTZ '2026-11-30 23:59:59.999999+00'),"
                        + " (?, 1, 'SETTINGS', TIMESTAMPTZ '2026-12-01 00:00:00+00')",
                userId,
                userId);

        SatisfactionSurveySummary summary = repository.summarize(from, to);

        assertThat(summary.responseCount()).isEqualTo(4);
        assertThat(summary.averageScore()).isEqualByComparingTo(new BigDecimal("3.25"));
    }

    @Test
    void 기간집계는_소수둘째자리_반올림() {
        Instant from = Instant.parse("2026-11-01T00:00:00Z");
        insertAt(5, from);
        insertAt(5, from);
        insertAt(4, from);

        assertThat(repository.summarize(from, from.plusSeconds(1)).averageScore())
                .isEqualByComparingTo(new BigDecimal("4.67"));
    }

    @Test
    void 응답이_없는_기간은_0건_평균null() {
        SatisfactionSurveySummary summary =
                repository.summarize(
                        Instant.parse("2026-01-01T00:00:00Z"),
                        Instant.parse("2026-02-01T00:00:00Z"));
        assertThat(summary.responseCount()).isZero();
        assertThat(summary.averageScore()).isNull();
    }

    @Test
    void 응답자기준_집계는_회원마다_한번씩_반영한다() {
        Instant from = Instant.parse("2026-11-01T00:00:00Z");
        Instant to = Instant.parse("2026-12-01T00:00:00Z");
        long other =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('survey_other','hash','다른러너','2000-01-01','FEMALE','01076340002','AGREE')
                        RETURNING id
                        """,
                        Long.class);
        // 이 회원: 5, 5, 5, 5 (기간 밖 1은 제외) → 회원 평균 5
        insertAt(5, from);
        insertAt(5, from);
        insertAt(5, from);
        insertAt(5, Instant.parse("2026-11-30T23:59:59Z"));
        insertAt(1, to);
        // 다른 회원: 2 → 회원 평균 2
        jdbc.update(
                "INSERT INTO satisfaction_survey_responses(user_id, score, source, created_at)"
                        + " VALUES (?, 2, 'SETTINGS', ?)",
                other,
                java.sql.Timestamp.from(from));

        SatisfactionSurveySummary byResponse = repository.summarize(from, to);
        SatisfactionSurveySummary byRespondent = repository.summarizeByRespondent(from, to);

        assertThat(byResponse.responseCount()).isEqualTo(5);
        assertThat(byResponse.averageScore()).isEqualByComparingTo(new BigDecimal("4.40"));
        assertThat(byRespondent.responseCount()).isEqualTo(2);
        assertThat(byRespondent.averageScore()).isEqualByComparingTo(new BigDecimal("3.50"));
    }

    @Test
    void 응답자기준_집계도_응답이_없으면_0명_평균null() {
        SatisfactionSurveySummary summary =
                repository.summarizeByRespondent(
                        Instant.parse("2026-01-01T00:00:00Z"),
                        Instant.parse("2026-02-01T00:00:00Z"));
        assertThat(summary.responseCount()).isZero();
        assertThat(summary.averageScore()).isNull();
    }

    private ResultActions submit(String body) throws Exception {
        return mockMvc.perform(
                post("/api/v1/satisfaction-surveys")
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private int count() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM satisfaction_survey_responses", Integer.class);
    }

    private void insertAt(int score, Instant at) {
        jdbc.update(
                "INSERT INTO satisfaction_survey_responses(user_id, score, source, created_at)"
                        + " VALUES (?, ?, 'SETTINGS', ?)",
                userId,
                score,
                Timestamp.from(at));
    }
}
