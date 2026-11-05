package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * S15P31E105-294 — 운영 기본 DB 대기 상한(연결 5초·생존 검사 2초·잠금 5초·쿼리 10초·소켓 15초)이 실제 연결 풀에 적용되는지 확인한다.
 *
 * <p>상한을 넘었을 때 503으로 끝나는 동작은 짧은 테스트 값으로 {@link RunningSessionDbTimeoutIntegrationTest}와
 * {@code DatabaseUnavailableIntegrationTest}가 확인한다. 재정의 값의 적용은 {@link DatabaseTimeoutOverrideIntegrationTest}가 본다.
 */
class RunningSessionDbTimeoutDefaultsIntegrationTest extends RunningSessionIntegrationSupport {

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
}
