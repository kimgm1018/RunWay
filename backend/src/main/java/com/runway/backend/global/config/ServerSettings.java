package com.runway.backend.global.config;

import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.util.StringUtils;

@Configuration(proxyBeanMethods = false)
public class ServerSettings {

    @Bean
    static BeanFactoryPostProcessor requiredServerSettings(Environment environment) {
        return beanFactory -> validate(environment);
    }

    static void validate(Environment environment) {
        if (environment.containsProperty("server.address")
                && !StringUtils.hasText(environment.getProperty("server.address"))) {
            throw new IllegalStateException(
                    "BACKEND_BIND_ADDRESS가 비어 있습니다. 값을 지우거나 접근할 주소를 지정하세요.");
        }
    }
}
