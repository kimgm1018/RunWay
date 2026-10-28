package com.runway.backend.global.config;

import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.util.StringUtils;

@Configuration(proxyBeanMethods = false)
public class DatabaseSettings {

    private static final Set<String> CREDENTIAL_PARAMETERS =
            Set.of("user", "password", "sslpassword");

    @Bean
    static BeanFactoryPostProcessor requiredDatabaseSettings(Environment environment) {
        return beanFactory -> validate(environment);
    }

    static void validate(Environment environment) {
        var missing = new ArrayList<String>();
        require(environment, "spring.datasource.url", "BACKEND_DB_URL", missing);
        require(environment, "spring.datasource.username", "BACKEND_DB_USERNAME", missing);
        require(environment, "spring.datasource.password", "BACKEND_DB_PASSWORD", missing);
        if (!missing.isEmpty()) {
            throw new IllegalStateException("필수 환경변수 누락: " + String.join(", ", missing));
        }
        if (containsCredentials(environment.getProperty("spring.datasource.url"))) {
            throw new IllegalStateException(
                    "BACKEND_DB_URL에 인증정보를 넣을 수 없습니다. "
                            + "BACKEND_DB_USERNAME, BACKEND_DB_PASSWORD를 사용하세요.");
        }
    }

    static boolean containsCredentials(String url) {
        var queryStart = url.indexOf('?');
        var beforeQuery = queryStart < 0 ? url : url.substring(0, queryStart);
        var authorityStart = beforeQuery.indexOf("//");
        if (authorityStart >= 0) {
            var rest = beforeQuery.substring(authorityStart + 2);
            var pathStart = rest.indexOf('/');
            var authority = pathStart < 0 ? rest : rest.substring(0, pathStart);
            if (authority.contains("@")) {
                return true;
            }
        }
        if (queryStart < 0) {
            return false;
        }
        for (var parameter : url.substring(queryStart + 1).split("&")) {
            var name = parameter.split("=", 2)[0].trim().toLowerCase(Locale.ROOT);
            if (CREDENTIAL_PARAMETERS.contains(name)) {
                return true;
            }
        }
        return false;
    }

    private static void require(
            Environment environment,
            String property,
            String variable,
            java.util.List<String> missing) {
        if (!StringUtils.hasText(environment.getProperty(property))) {
            missing.add(variable);
        }
    }
}
