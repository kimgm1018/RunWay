package com.runway.securityfixture;

import com.runway.backend.global.config.OpenApiConfig;
import com.runway.backend.global.exception.GlobalExceptionHandler;
import com.runway.backend.global.security.AuthenticatedUser;
import com.runway.backend.global.security.SecurityConfig;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration;
import org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Real servlet security/OpenAPI stack without domain repositories; DB cases run separately. */
@Configuration(proxyBeanMethods = false)
@EnableAutoConfiguration(
        exclude = {
            DataSourceAutoConfiguration.class,
            HibernateJpaAutoConfiguration.class,
            FlywayAutoConfiguration.class
        })
@Import({
    SecurityConfig.class,
    OpenApiConfig.class,
    GlobalExceptionHandler.class,
    SecurityTestApplication.Fixture.class
})
public class SecurityTestApplication {

    // 이 보안 전용 fixture에는 실제 DB·Redis가 없다. readiness 검증은 별도 통합 테스트에서 한다.
    @Bean
    HealthIndicator dbHealthIndicator() {
        return () -> Health.unknown().build();
    }

    @Bean
    HealthIndicator redisHealthIndicator() {
        return () -> Health.unknown().build();
    }

    @RestController
    static class Fixture {
        static final CyclicBarrier REQUESTS = new CyclicBarrier(2);

        @PostMapping({
            "/api/v1/auth/login",
            "/api/v1/auth/signup",
            "/api/v1/auth/refresh",
            "/api/v1/auth/logout"
        })
        String publicPost() {
            return "public-handler";
        }

        @GetMapping("/api/v1/auth/login-id/availability")
        String availability() {
            return "public-handler";
        }

        @GetMapping("/api/v1/images/{imageId}")
        String publicImage() {
            return "public-image";
        }

        @GetMapping("/__test/who")
        Map<String, Long> who(@AuthenticationPrincipal AuthenticatedUser user) {
            return Map.of("id", user.id());
        }

        @GetMapping("/__test/parallel")
        Map<String, Long> parallel(@AuthenticationPrincipal AuthenticatedUser user)
                throws Exception {
            REQUESTS.await(10, TimeUnit.SECONDS);
            var current =
                    (AuthenticatedUser)
                            SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            return Map.of("id", user.id(), "contextId", current.id());
        }
    }
}
