package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;

/** S15P31E105-294 — 환경변수 이름으로 DB 대기 상한을 재정의할 수 있다. */
@SpringBootTest(
        properties = {
            "BACKEND_DB_CONNECTION_TIMEOUT_MS=4321",
            "BACKEND_DB_LOCK_TIMEOUT_MS=1234",
            "BACKEND_DB_STATEMENT_TIMEOUT_MS=6789",
            "BACKEND_DB_SOCKET_TIMEOUT_S=21"
        })
@AutoConfigureMockMvc
class DatabaseTimeoutOverrideIntegrationTest extends RunningSessionIntegrationSupport {

    @Autowired DataSource dataSource;

    @Test
    void 환경변수로_재정의한_값이_풀_연결에_적용된다() {
        assertThat(jdbc.queryForObject("SHOW lock_timeout", String.class)).isEqualTo("1234ms");
        assertThat(jdbc.queryForObject("SHOW statement_timeout", String.class))
                .isEqualTo("6789ms");
        HikariDataSource hikari = (HikariDataSource) dataSource;
        assertThat(hikari.getConnectionTimeout()).isEqualTo(4_321);
        assertThat(hikari.getDataSourceProperties().getProperty("socketTimeout")).isEqualTo("21");
    }
}
