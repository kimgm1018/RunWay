package com.runway.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Status;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;

class DependencyHealthConfigTest {
    private final DependencyHealthConfig config = new DependencyHealthConfig();

    @Test
    void DB연결만_검사하고_닫는다() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(true);
        assertThat(config.dbHealthIndicator(source).health().getStatus()).isEqualTo(Status.UP);
        verify(connection).isValid(2);
        verify(connection).close();
        verifyNoMoreInteractions(connection);
    }

    @Test
    void DB오류원문을_상태에_담지않는다() throws Exception {
        var source = mock(DataSource.class);
        when(source.getConnection()).thenThrow(new SQLException("synthetic-sensitive-marker"));
        var health = config.dbHealthIndicator(source).health();
        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).isEmpty();
    }

    @Test
    void 유효하지않은_DB연결은_DOWN이다() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(false);
        assertThat(config.dbHealthIndicator(source).health().getStatus()).isEqualTo(Status.DOWN);
        verify(connection).close();
    }

    @Test
    void Redis는_PING만_수행하고_연결을_닫는다() {
        var factory = mock(RedisConnectionFactory.class);
        var connection = mock(RedisConnection.class);
        when(factory.getConnection()).thenReturn(connection);
        when(connection.ping()).thenReturn("PONG");
        assertThat(config.redisHealthIndicator(factory).health().getStatus()).isEqualTo(Status.UP);
        verify(connection).ping();
        verify(connection).close();
        verifyNoMoreInteractions(connection);
    }

    @Test
    void Redis오류와_잘못된응답은_DOWN이고_상세는_비어있다() {
        var factory = mock(RedisConnectionFactory.class);
        var connection = mock(RedisConnection.class);
        when(factory.getConnection()).thenReturn(connection);
        when(connection.ping()).thenReturn("unexpected");
        assertThat(config.redisHealthIndicator(factory).health().getStatus()).isEqualTo(Status.DOWN);
        when(factory.getConnection()).thenThrow(new IllegalStateException("synthetic-sensitive-marker"));
        var health = config.redisHealthIndicator(factory).health();
        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).isEmpty();
    }
}
