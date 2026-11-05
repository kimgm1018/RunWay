package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.runway.backend.domain.readiness.service.ReadinessEvaluationDispatcher;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 254 통합 테스트 공통 준비. 모든 건강값·날짜는 합성 데이터다. 하위 클래스들이 공유 서버의 전용 DB를 함께 쓴다.
 *
 * <p>W06 metricDate 허용 범위가 서버 UTC 오늘 −8일 ~ +1일이므로 W06으로 보내는 날짜는 UTC 오늘에서 계산하고, 평가 기준값(이전 날짜)은 DB에 직접 넣는다.
 */
abstract class ReadinessIntegrationSupport {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(ReadinessIntegrationSupport.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    protected static final String METHOD = "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2";

    @Autowired protected MockMvc mockMvc;
    @Autowired protected JdbcTemplate jdbc;

    protected long userId;
    protected long otherUserId;
    private int seq;

    @Autowired protected ReadinessEvaluationDispatcher dispatcher;

    /** 다른 컨텍스트의 테스트 클래스가 같은 DB를 쓰므로, 이 테스트가 남긴 평가를 끝내고 넘긴다. */
    @AfterEach
    void awaitLeftoverEvaluations() throws InterruptedException {
        awaitEvaluations();
    }

    @BeforeEach
    void resetData() throws InterruptedException {
        awaitEvaluations();
        jdbc.update("DELETE FROM daily_readiness");
        jdbc.update("DELETE FROM daily_health_metrics");
        jdbc.update("DELETE FROM users");
        userId = insertUser("AGREEE");
        otherUserId = insertUser("AGREEE");
    }

    /**
     * W06 테스트와 같은 이유로 UTC 자정 직전이면 날짜가 바뀐 뒤 시작한다. 테스트와 서버가 각자 오늘을 계산하므로 도중에 날짜가 바뀌면 범위 판정이 어긋난다.
     */
    @BeforeEach
    void avoidUtcMidnight() throws InterruptedException {
        var now = java.time.Instant.now();
        var nextMidnight =
                LocalDate.ofInstant(now, ZoneOffset.UTC).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        long leftMillis = Duration.between(now, nextMidnight).toMillis();
        if (leftMillis < 15_000) {
            Thread.sleep(leftMillis + 100);
        }
    }

    /** W06 커밋 후 별도 스레드에서 도는 준비도 평가가 모두 끝날 때까지 기다린다. */
    protected void awaitEvaluations() throws InterruptedException {
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(30))).isTrue();
    }

    protected static LocalDate today() {
        return LocalDate.now(ZoneOffset.UTC);
    }

    protected long insertUser(String healthDataAccess) {
        int n = seq++;
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?,'hash',?,'2000-01-01','MALE','01011112222',?::users_health_data_access_enum)
                RETURNING id
                """,
                Long.class,
                "rdy_user" + n,
                "준비도" + n,
                healthDataAccess);
    }

    /** 기준값용 일별 RHR을 DB에 직접 넣는다(W06 이벤트 없음). */
    protected void insertRestingHr(long user, LocalDate date, String bpm) {
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm,rhr_revision) VALUES (?,?,?,1)",
                user,
                date,
                new BigDecimal(bpm));
    }

    /** date 이전 days일(D-1~D-days)에 같은 RHR을 넣는다. */
    protected void insertBaseline(long user, LocalDate date, int days, String bpm) {
        for (int i = 1; i <= days; i++) {
            insertRestingHr(user, date.minusDays(i), bpm);
        }
    }

    protected void insertReadiness(long user, LocalDate date, String score, String confidence) {
        jdbc.update(
                "INSERT INTO daily_readiness(user_id,readiness_date,readiness_score,readiness_confidence)"
                        + " VALUES (?,?,?,?::daily_readiness_readiness_confidence_enum)",
                user,
                date,
                new BigDecimal(score),
                confidence);
    }

    protected List<Map<String, Object>> readinessRows(long user) {
        return jdbc.queryForList(
                "SELECT id, readiness_date, readiness_score, readiness_confidence::text AS confidence"
                        + " FROM daily_readiness WHERE user_id=? ORDER BY readiness_date",
                user);
    }

    protected int readinessCount() {
        return jdbc.queryForObject("SELECT count(*) FROM daily_readiness", Integer.class);
    }

    /** W06 일상 심박 추정값 레코드 JSON. */
    protected static String estimate(LocalDate date, int revision, String bpm) {
        return """
                {"type":"DAILY_HR_ESTIMATE","metricDate":"%s","revision":%d,"estimatedRestingHrBpm":%s,\
                "method":"%s","validSampleCount":812,"computedAt":"%sT09:00:00Z"}"""
                .formatted(date, revision, bpm, METHOD, date);
    }

    protected static String healthBody(String... records) {
        return "{\"provider\":\"RUNWAY_WATCH\",\"records\":[" + String.join(",", records) + "]}";
    }

    protected MockHttpServletRequestBuilder healthRequest(long user, String body) {
        return post("/api/v1/health-records/sync")
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    protected MockHttpServletRequestBuilder latestRequest(long user) {
        return get("/api/v1/readiness-assessments/latest")
                .header("Authorization", SecurityTestSupport.bearer(user));
    }
}
