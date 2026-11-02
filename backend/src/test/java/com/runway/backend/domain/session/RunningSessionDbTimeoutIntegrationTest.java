package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zaxxer.hikari.HikariDataSource;
import java.sql.DriverManager;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S15P31E105-294 — 기본 DB 대기 상한(잠금 5초·쿼리 10초)이 실제 연결에 적용되고, 초과 시 무한 대기 없이 503으로 응답하는지 확인한다.
 *
 * <p>세션 변경(S08)은 {@code SET LOCAL lock_timeout} 없이 {@code FOR UPDATE}로 세션 행을 잠그므로 전역 lock_timeout의
 * 적용을 확인하는 경로로 쓴다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
// 설정이 빠지면 무한 대기로 빌드가 멈추지 않고 실패하도록 한다.
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class RunningSessionDbTimeoutIntegrationTest extends RunningSessionIntegrationSupport {

    static final long LOCK_TIMEOUT_MS = 5_000;
    static final long STATEMENT_TIMEOUT_MS = 10_000;
    /** 예외 변환·응답 작성과 CI 지연을 고려한 여유. */
    static final long MARGIN_MS = 3_000;

    static final String UPDATE_GOAL =
            "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetPaceSecPerKm\":300}";

    @Autowired DataSource dataSource;

    @Test
    void 기본_대기_상한이_풀_연결에_적용된다() {
        assertThat(jdbc.queryForObject("SHOW lock_timeout", String.class)).isEqualTo("5s");
        assertThat(jdbc.queryForObject("SHOW statement_timeout", String.class)).isEqualTo("10s");
        HikariDataSource hikari = (HikariDataSource) dataSource;
        assertThat(hikari.getConnectionTimeout()).isEqualTo(5_000);
        assertThat(hikari.getValidationTimeout()).isEqualTo(2_000);
        assertThat(hikari.getDataSourceProperties().getProperty("socketTimeout")).isEqualTo("15");
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
                long elapsed = timedPatch(sessionId);
                assertThat(elapsed).isBetween(LOCK_TIMEOUT_MS - 500, LOCK_TIMEOUT_MS + MARGIN_MS);
            } finally {
                holder.rollback();
            }
        }
        assertThat(stateVersion(sessionId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
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
            long elapsed = timedPatch(sessionId);
            assertThat(elapsed)
                    .isBetween(STATEMENT_TIMEOUT_MS - 500, STATEMENT_TIMEOUT_MS + MARGIN_MS);
        } finally {
            jdbc.execute("DROP TRIGGER slow_session_update_294 ON running_sessions");
            jdbc.execute("DROP FUNCTION slow_session_update_294()");
        }
        assertThat(stateVersion(sessionId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    private long timedPatch(long sessionId) throws Exception {
        long started = System.nanoTime();
        ResultActions result = mockMvc.perform(patchRequest(userId, sessionId, UPDATE_GOAL));
        long elapsed = (System.nanoTime() - started) / 1_000_000;
        result.andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.details").isEmpty());
        return elapsed;
    }
}
