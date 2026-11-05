package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.DriverManager;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S15P31E105-294 — DB 대기 상한(잠금·쿼리)을 넘으면 무한 대기 없이 503으로 응답하고 세션을 바꾸지 않는지 확인한다.
 *
 * <p>운영 기본값(잠금 5초·쿼리 10초)을 그대로 기다리지 않도록 같은 설정 키에 짧은 테스트 값을 넣는다. 기본값의 적용은
 * {@link RunningSessionDbTimeoutDefaultsIntegrationTest}가 확인한다(S15P31E105-482).
 *
 * <p>503의 원인은 경과 시간이 아니라 공통 처리기가 받은 예외의 SQLState(잠금 55P03, 쿼리 57014)로 확인한다. 서버 쪽 대기 타이머와
 * 테스트 JVM의 경과 측정은 부하에 따라 어긋날 수 있어, 상한보다 짧게 측정되는 경우가 실제로 있었다(S15P31E105-482). 경과 시간은 무한
 * 대기가 아님을 보는 상한만 검사하며, 설정값은 {@code SHOW}로 직접 확인한다.
 *
 * <p>세션 변경(S08)은 {@code SET LOCAL lock_timeout} 없이 {@code FOR UPDATE}로 세션 행을 잠그므로 전역 lock_timeout의
 * 적용을 확인하는 경로로 쓴다.
 */
@Testcontainers
// 설정이 빠지면 무한 대기로 빌드가 멈추지 않고 실패하도록 한다.
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
@TestPropertySource(
        properties = {"BACKEND_DB_LOCK_TIMEOUT_MS=1000", "BACKEND_DB_STATEMENT_TIMEOUT_MS=2000"})
class RunningSessionDbTimeoutIntegrationTest extends RunningSessionIntegrationSupport {

    static final long LOCK_TIMEOUT_MS = 1_000;
    static final long STATEMENT_TIMEOUT_MS = 2_000;
    static final String LOCK_NOT_AVAILABLE = "55P03";
    static final String QUERY_CANCELED = "57014";
    /** 예외 변환·응답 작성과 CI 지연을 고려한 여유. */
    static final long MARGIN_MS = 3_000;

    static final String UPDATE_GOAL =
            "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetPaceSecPerKm\":300}";

    @Test
    void 테스트_대기_상한이_풀_연결에_적용된다() {
        assertThat(jdbc.queryForObject("SHOW lock_timeout", String.class)).isEqualTo("1s");
        assertThat(jdbc.queryForObject("SHOW statement_timeout", String.class)).isEqualTo("2s");
    }

    @Test
    void 행_잠금_대기가_상한을_넘으면_503이고_세션은_바뀌지_않는다() throws Exception {
        long sessionId = insertReadySession();
        try (var holder =
                DriverManager.getConnection(
                        DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword())) {
            holder.setAutoCommit(false);
            try (var statement =
                    holder.prepareStatement("SELECT id FROM running_sessions WHERE id=? FOR UPDATE")) {
                statement.setLong(1, sessionId);
                statement.executeQuery().close();
            }
            try {
                long elapsed = timedPatch(sessionId, LOCK_NOT_AVAILABLE);
                assertThat(elapsed).isLessThanOrEqualTo(LOCK_TIMEOUT_MS + MARGIN_MS);
            } finally {
                holder.rollback();
            }
        }
        assertThat(stateVersion(sessionId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    /**
     * S01은 기기 행을 JdbcTemplate으로 FOR SHARE 잠근다. JdbcTemplate은 잠금 대기 초과(55P03)를 분류하지 못하므로 공통 처리기가 SQLState로 503을
     * 응답해야 한다(S15P31E105-253에서 수정, 이전에는 500).
     */
    @Test
    void JdbcTemplate_잠금_대기가_상한을_넘어도_503이고_세션을_만들지_않는다() throws Exception {
        try (var holder =
                DriverManager.getConnection(
                        DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword())) {
            holder.setAutoCommit(false);
            try (var statement =
                    holder.prepareStatement("SELECT id FROM user_devices WHERE id=? FOR UPDATE")) {
                statement.setLong(1, watchId);
                statement.executeQuery().close();
            }
            try {
                long started = System.nanoTime();
                ResultActions result = mockMvc.perform(createRequest(userId, "{" + devices() + "}"));
                long elapsed = (System.nanoTime() - started) / 1_000_000;
                assertUnavailableBy(result, LOCK_NOT_AVAILABLE);
                assertThat(elapsed).isLessThanOrEqualTo(LOCK_TIMEOUT_MS + MARGIN_MS);
            } finally {
                holder.rollback();
            }
        }
        assertThat(count("SELECT count(*) FROM running_sessions WHERE user_id=?", userId)).isZero();
    }

    @Test
    void 쿼리_실행이_상한을_넘으면_503이고_세션은_바뀌지_않는다() throws Exception {
        long sessionId = insertReadySession();
        jdbc.execute(
                """
                CREATE FUNCTION slow_session_update_294() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN PERFORM pg_sleep(15); RETURN NEW; END $$
                """);
        jdbc.execute(
                "CREATE TRIGGER slow_session_update_294 BEFORE UPDATE ON running_sessions"
                        + " FOR EACH ROW EXECUTE FUNCTION slow_session_update_294()");
        try {
            long elapsed = timedPatch(sessionId, QUERY_CANCELED);
            assertThat(elapsed).isLessThanOrEqualTo(STATEMENT_TIMEOUT_MS + MARGIN_MS);
        } finally {
            jdbc.execute("DROP TRIGGER slow_session_update_294 ON running_sessions");
            jdbc.execute("DROP FUNCTION slow_session_update_294()");
        }
        assertThat(stateVersion(sessionId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    private long timedPatch(long sessionId, String expectedSqlState) throws Exception {
        long started = System.nanoTime();
        ResultActions result = mockMvc.perform(patchRequest(userId, sessionId, UPDATE_GOAL));
        long elapsed = (System.nanoTime() - started) / 1_000_000;
        assertUnavailableBy(result, expectedSqlState);
        return elapsed;
    }

    /** 503 응답과 함께, 공통 처리기가 받은 예외가 기대한 DB 대기 상한 초과로 생긴 것인지 확인한다. */
    private static void assertUnavailableBy(ResultActions result, String expectedSqlState)
            throws Exception {
        MvcResult mvcResult =
                result.andExpect(status().isServiceUnavailable())
                        .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                        .andExpect(jsonPath("$.details").isEmpty())
                        .andReturn();
        assertThat(sqlState(mvcResult.getResolvedException())).isEqualTo(expectedSqlState);
    }

    private static String sqlState(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
        }
        return null;
    }
}
