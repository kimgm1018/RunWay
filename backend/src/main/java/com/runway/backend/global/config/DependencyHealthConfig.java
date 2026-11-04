package com.runway.backend.global.config;

import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;

@Configuration(proxyBeanMethods = false)
public class DependencyHealthConfig {

    @Bean
    HealthIndicator dbHealthIndicator(DataSource dataSource) {
        return () -> {
            // 업무 테이블을 조회하거나 쓰지 않고 연결만 확인한다.
            try (var connection = dataSource.getConnection()) {
                return connection.isValid(2) ? Health.up().build() : Health.down().build();
            } catch (Exception exception) {
                // 연결 오류 원문에는 접속 정보가 포함될 수 있어 응답·로그에 담지 않는다.
                return Health.down().build();
            }
        };
    }

    @Bean
    HealthIndicator redisHealthIndicator(
            @Qualifier("authenticationRedisConnectionFactory") RedisConnectionFactory factory) {
        return () -> {
            // INFO 권한을 추가하지 않고 기존 인증 연결의 PING만 사용한다.
            try (var connection = factory.getConnection()) {
                return "PONG".equals(connection.ping())
                        ? Health.up().build()
                        : Health.down().build();
            } catch (Exception exception) {
                return Health.down().build();
            }
        };
    }
}
