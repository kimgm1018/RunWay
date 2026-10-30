package com.runway.backend.domain.auth.config;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

@Configuration(proxyBeanMethods = false)
public class AuthenticationRedisConfig {
    @Bean
    RedisSettings authenticationRedisSettings(Environment environment) {
        return RedisSettings.load(environment);
    }

    @Bean
    LettuceConnectionFactory authenticationRedisConnectionFactory(RedisSettings settings) {
        var server = new RedisStandaloneConfiguration(settings.host(), settings.port());
        server.setUsername(settings.username());
        server.setPassword(RedisPassword.of(settings.password()));
        var builder =
                LettuceClientConfiguration.builder()
                        .commandTimeout(Duration.ofSeconds(2))
                        .clientOptions(
                                ClientOptions.builder()
                                        .autoReconnect(false)
                                        .disconnectedBehavior(
                                                ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                                        .socketOptions(
                                                SocketOptions.builder()
                                                        .connectTimeout(Duration.ofSeconds(1))
                                                        .build())
                                        .build());
        if (settings.ssl()) builder.useSsl();
        var factory = new LettuceConnectionFactory(server, builder.build());
        factory.setValidateConnection(true);
        return factory;
    }

    @Bean
    StringRedisTemplate authenticationRedisTemplate(
            LettuceConnectionFactory authenticationRedisConnectionFactory) {
        return new StringRedisTemplate(authenticationRedisConnectionFactory);
    }

    public record RedisSettings(
            String host, int port, String username, String password, boolean ssl) {
        public static RedisSettings load(Environment environment) {
            String prefix = "runway.auth.redis.";
            var missing = new ArrayList<String>();
            String host = required(environment, prefix, "host", missing);
            String port = required(environment, prefix, "port", missing);
            String username = required(environment, prefix, "username", missing);
            String password = required(environment, prefix, "password", missing);
            String ssl = environment.getProperty(prefix + "ssl-enabled", "false");
            if (!missing.isEmpty())
                throw new IllegalStateException("필수 환경변수 누락: " + String.join(", ", missing));
            int number;
            try {
                number = Integer.parseInt(port);
            } catch (NumberFormatException exception) {
                throw new IllegalStateException("BACKEND_REDIS_PORT 형식 오류");
            }
            if (number < 1 || number > 65535)
                throw new IllegalStateException("BACKEND_REDIS_PORT 형식 오류");
            if (!host.matches("[A-Za-z0-9._:-]+"))
                throw new IllegalStateException("BACKEND_REDIS_HOST 형식 오류");
            if (!username.matches("[A-Za-z][A-Za-z0-9_-]{0,31}"))
                throw new IllegalStateException("BACKEND_REDIS_USERNAME 형식 오류");
            if (!List.of("true", "false").contains(ssl))
                throw new IllegalStateException("BACKEND_REDIS_SSL_ENABLED 형식 오류");
            return new RedisSettings(host, number, username, password, Boolean.parseBoolean(ssl));
        }

        private static String required(
                Environment environment, String prefix, String key, List<String> missing) {
            String value = environment.getProperty(prefix + key);
            if (value == null || value.isBlank())
                missing.add("BACKEND_REDIS_" + key.toUpperCase(java.util.Locale.ROOT));
            return value;
        }

        @Override
        public String toString() {
            return "RedisSettings[REDACTED]";
        }
    }
}
